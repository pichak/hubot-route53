/*
 * See route53-doc.coffee for standard module description
 *
 * Notes:
 *   Do not set Amazon credentials in local machines
 */

var util = require('util');
var _ = require('lodash');
var assert = require('assert');
var bp = require('body-parser');
var route53 = require('../lib/common');

// to ensure hubot -or other common deps- is in our current import path,
// even if this plugin is not installed into application's subdirectories.
module.parent.paths.forEach(function(p,i) {
	module.paths.push(p);
});
var hubot = require('/home/reith/projects/pichak/asgharoid/node_modules/hubot');
var hubot_messages = require('hubot/src/message');

var represent = {
	record: _.template('<%=Name%>\t<%=Type%>\t' +
	'<% if (typeof AliasTarget == "undefined") { %>' +
		'<%= TTL %>\t' +
		'<%= _.collect(ResourceRecords, function(rr) { return rr.Value }) %>\t' +
	'<%} else {%>' +
		'alias_for=<%= AliasTarget.DNSName %> ' +
		'evaluate_target_health=<%= AliasTarget.EvaluateTargetHealth %> ' +
	'<%} %>' +
	'<% if (typeof Weight != "undefined") print("weight="+Weight+" ") %>' +
	'<% if (typeof SetIdentifier != "undefined") print("set="+SetIdentifier+" ") %>'),
	newChangeInfo: _.template('Created change <%= Id %>. Current status: <%= Status %>'),
	storedChangeInfo: _.template('Submitted at <%= SubmittedAt %>\nCurrent Status: <%= Status %>'),
	zone: _.template('<%= Name %> [#<%= Id %>] has <%= ResourceRecordSetCount %> records.')
};

module.exports = function(robot) {

	robot.respond(/route53\s+ls\s+zones\s*$/i, function(resp) {
		new route53.call(resp).listHostedZones({}, function(err, data) {
			if (err) return this.request.service.defaultErrorHandler(err);
			return resp.reply(_.collect(data.HostedZones, function(zone) {
					return zone.Name;
			}).join("\n"));
		});
	});

	robot.respond(/route53\s+show\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp).zoneNamed(resp.match[1], function(zone) {
			resp.reply(represent.zone(zone));
		});
	});

	robot.respond(/route53\s+ls\s+(\S+)\s+records\s*$/i, function(resp) {
		new route53.call(resp).zoneNamed(resp.match[1], function(zone) {
			this.list = [];
			this.zoneRecords(zone, function(record) {
					this.list.push(represent.record(record));
				}, function() {
					resp.reply(_.uniq(this.list).join('\n'));
					delete this.list;
				});
		});
	});

	robot.respond(new RegExp('route53\\s+(add|create|append)' +
			'(?:\\s+(\\d+))?' + // policy options, currently just weighted
			'(?:\\s+(weighted|simple))?' +
			'\\s+record(?:\\s+set\\s+(\\S+))?' +
			'\\s+(\\S+)\\s+' + route53.helper.patterns.valid_types +
			'(?:' +
				'(?:\\s+alias\\s+for\\s+(\\S+)((?:\\s+(don\'t|not|do not))?\\s+check\\s+target\\s+health)?)' +
			'|' +
				'(?:\\s+(\\d+)\\s+(\\S.+))' +
			')\\s*$', 'i'),
		function(resp) {
			var record;
			var command = [
				resp.match[1],
				(record = {
					weight: resp.match[2],
					policy: resp.match[3] && resp.match[3].toLowerCase(),
					set: resp.match[4],
					name: resp.match[5],
					type: resp.match[6].toUpperCase(),
					ttl: resp.match[10],
					data: resp.match[11],
					alias_target: resp.match[7],
					check_target_health: Boolean(resp.match[8] && ! resp.match[9]),
				})
			];

			new route53.call(resp, {need: 'maintainer'})
				.hostZone(record.name, function(zone) {
				// set some default values from pichak
				if (record.policy && record.policy != 'simple'
					  && record.set==undefined) {
					if (record.alias_target)
						// set_identifier is subdomain part of target
						record.set = record.alias_target.substr(0, 
							(record.alias_target + '.').indexOf(zone.Name)-1);
					else
						// It's value part of resource record
						record.set = record.data;
				};

				try {
					var params = makeRecordsChangeParams([command,], zone);
				} catch (e) {
					resp.reply('Error: ' + e);
					return;
				}

				this.changeResourceRecordSets(params,
					function(err, data) {
						if (err)
							return resp.reply('Error occured ' + err);
						return resp.reply(represent
							.newChangeInfo(data.ChangeInfo));
				});
			});
		}
	);

	robot.respond(/route53\s+show\s+change\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp).getChange({ Id: resp.match[1] }, function(err, data) {
			return err ? resp.reply('Error: ' + err) : resp.reply(represent.storedChangeInfo(data.ChangeInfo));
		});
	});


	robot.respond(/route53\s+create\s+zone\s+(\S+)\\s*$/i, function(resp) {
		var name = resp.match[1];
		new route53.call(resp, {need: 'maintainer'}).createHostedZone({
				CallerReference: 'C' + name,
				Name: name,
				HostedZoneConfig: {
					Comment: 'Made by ' + resp.match[0]
				}
			}, function(err, data) {
				if (err) return resp.reply('Error: ' + err);
				resp.reply(represent.newChangeInfo(data.ChangeInfo));
				resp.reply(represent.zone(data.HostedZone));
			});
	});

	robot.respond(/route53\s+show\s+records?\s+(.+)\s*$/i, function(resp) {
		var m, name, type, selector;
		var select_str = resp.match[1];

		if (m = select_str.match(
				new RegExp('aliased to ' + route53.helper.patterns.name_maybe_with_type, 'i'))) {

			var selector = function(record) {
				return record.AliasTarget && record.AliasTarget.DNSName === name
						&& (record.Type === type || type === undefined);
			};
		} else if (m = select_str.match(
				new RegExp(route53.helper.patterns.name_maybe_with_type, 'i'))) {

			var selector = function(record) {
				return record.Name === name && (record.Type === type || type === undefined)
			}
		} else {
			return resp.reply('Invalid invocation of show records.');
		}

		name = m[1];
		type = m[2];
		if (! _.endsWith(name, '.')) name += '.';

		new route53.call(resp).data('records', []).hostZone(name, function(zone) {
				this.zoneRecords(zone, function(record) {
						this.data('records').push(represent.record(record));
					}, function() {
						var results = _.uniq(this.data('records'));
						this.unset('records');
						resp.reply(results.length ? results.join('\n') : 'No record found');
					}, {
						predicate: selector
					}
				);
			});
	});


	robot.respond(/route53\s+update\s+record\s+(.*)\s+set\s+(?:weight\s+to\s+(\d+)|data\s+to\s+(\S+))\s*$/i, function(resp) {
		var m, alias_lookup;
		var new_weight = resp.match[2];
		var new_data = resp.match[3];

		// TODO: this is now closure lock free, could pushed up
		var call_on_target = function(target_record, look_for_alias, update_callback) {
			// look for alias records assigned to passed in record
			this.hostZone(target_record.Name, function(zone) {

				if (! look_for_alias) {
					update_callback.call(this, target_record); // all is done, bye
					return;

				} else {
					// look for alias records and pick single one poiting to target record, then update it
					this.selected_records = [];

					this.zoneRecords(
						zone,
						function(record) {
							if (record.AliasTarget && record.AliasTarget.DNSName === target_record.Name &&
									record.Type === target_record.Type)
								this.selected_records.push(record);
						},

						function() {
							this.selected_records = _.uniq(this.selected_records, function(r) { return r.Name + r.Type + r.SetIdentifier; });

							if (this.selected_records.length === 0)
								this.defaultErrorHandler('No record found');

							else if (this.selected_records.length > 1)
								this.defaultErrorHandler('More than one record found: \n' +
									_.collect(this.selected_records,
														function(r) { return represent.record(r); })
									.join('\n') +'\nI refuse to do anything');

							else
								update_callback.call(this, this.selected_records[0]);

							delete this.selected_records;
						}
					);
				}
			});
		};

		if (m = resp.match[1].match(
				new RegExp('^aliased to '+route53.helper.patterns.name_maybe_with_type, 'i'))) {

			alias_lookup = true;

		} else if (m = resp.match[1].match(new RegExp(route53.helper.patterns.name_maybe_with_type, 'i'))) {

			alias_lookup = false;

		} else {

			resp.reply('Dude.. You invoking me badly.. see examples.');
			return;

		};

		new route53.call(resp, {need: 'maintainer'}).resourceRecord({
			Name: m[1],
			Type: m[2]
		}, function(r) {
			call_on_target.call(this, r, alias_lookup, function(actual_record) {
				var new_record;

				normalizeRecordForResend(actual_record);
				if (new_weight != undefined)
					new_record = updaters.set_weight(actual_record, new_weight);
				else if (new_data != undefined)
					new_record = updaters.set_data(actual_record, new_data);
				else {
					resp.reply('No known action for update.');
					return;
				}

				this.changeResourceRecordSets({
					HostedZoneId: this.zone.Id,
					ChangeBatch: { Changes: [
						{ Action: 'DELETE', ResourceRecordSet: actual_record },
						{ Action: 'CREATE', ResourceRecordSet: new_record }
					], Comment: resp.match[0]
					}
				}, function(err, data) {
					if (err)
						resp.reply('Error: ' + err.message);
					else
						return resp.reply(represent.newChangeInfo(data.ChangeInfo));
				});
			});
		});
	});


	robot.respond(/route53\s+delete\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp, {need: 'maintainer'}).zoneNamed(resp.match[1], function(zone) {
			this.deleteHostedZone({
				Id: zone.Id
			}, function(err, data) {
				if (err) return resp.reply('Error: ' + err);
				return resp.reply(represent.newChangeInfo(data.ChangeInfo));
			});
		});
	});


	robot.respond(/route53\s+examples\s*$/i, function(resp) {
		resp.reply('Add plain resource record:');
		resp.reply('> route53 add record us5.free.vpnintouch.net A 60 192.168.23.11\n');
		resp.reply('Add weighted resource record with set identifier 10wset:');
		resp.reply('> route53 add 10 weighted record set 10wset w10.some.zone A 60 192.122.12.13\n');
		resp.reply('Add aliased weighted resource record set with auto generated set identifier from target name [sub]:');
		resp.reply('> route53 add 15 weighted record free.vpnintouch.net A alias for us5.free.vpnintouch.net check target health\n');
		resp.reply('Changes will observabe instantly by printing zone records: ');
		resp.reply('> route53 ls 34894.website records \n');
		resp.reply('Show details of a record');
		resp.reply('> route53 show records us5.free.vpnintouch.net');
		resp.reply('Or if there is many records defined, a more selective version: ');
		resp.reply('> route53 show records aliased to us45.ipsec.34854.website');
		resp.reply('Or more selective: ');
		resp.reply('> route53 show records aliased to us45.ipsec.34854.website A\n');
		resp.reply('It show records by changed state, but in fact changes are not fully operational until state become INSYNC');
		resp.reply('> route53 show change C12UGSTBO1H3B2\n');
		resp.reply('To update weight of some record:');
		resp.reply('> route53 update record ipsec.34854.website A set weight to 5');
		resp.reply('Record types are optional if it result to single record.\n');
		resp.reply('Weighted alias resource record sets are not different:');
		resp.reply('> route53 update record ipsec.34854.website A set weight to 1');
		resp.reply('Also, It can be selected by It\'s target record:');
		resp.reply('> route53 update record aliased to us45.ipsec.34854.website set weight to 5\n');
		resp.reply('Notice: Update will not work for multiple records');
	});


	robot.listeners.push(new hubot.Listener(robot,
		function(msg) {
			return msg instanceof hubot_messages.CatchAllMessage
				&& new RegExp(robot.name + '\\s+route53 ?.*', 'i').test(msg.message.text);
		},
		function(resp) {
			resp.reply('Bad route53 command invocation');
		})
	);

	/*
	 * commands are array of `action` and `record` tuple
	 * return parameters for passing to server
	 */
	var makeRecordsChangeParams = function(commands, zone) {
		var changes;
		var params = {
			HostedZoneId: zone.Id,
			ChangeBatch: {
				Changes: (changes = [])
			}
		};

		_.each(commands, function(v) {
			var action;
			var policy = v[1].policy === 'weighted' ? 'weighted' : 'simple';
			var rr_set, rrs, change;

			switch(v[0] && v[0].toLowerCase()) {
				case 'add':
				case 'create':
				case 'append': action = 'CREATE'; break;
				case 'remove':
				case 'delete': action = 'DELETE'; break;
				default: throw new Error("Unknown action " + v[0]);
			};

			assert.equal(v[1].policy === undefined || v[1].policy === 'simple',
				v[1].set === undefined,
				"non-simple policy needs set identifier");
			assert.equal(v[1].policy === "weighted", v[1].weight !== undefined,
				"weighted set need weight specified");

			changes.push((change = {
					Action: action,
					ResourceRecordSet: (rr_set = {
							Name: v[1].name,
							Type: v[1].type,
					})
			}));

			if (v[1].alias_target) {
				rr_set['AliasTarget'] = {
					HostedZoneId: zone.Id.split('/').pop(),
					DNSName: v[1].alias_target,
					EvaluateTargetHealth: v[1].check_target_health
				};

			} else {
				rr_set['TTL'] = v[1].ttl;
				rr_set['ResourceRecords'] = rrs = [];

				switch(v[1].type) {
					case 'SPF': // TODO
					case 'TXT': // TODO
					case 'SOA':
					case 'CNAME': rrs.push({Value: rr_data }); break;
					default: _.each(v[1].data.split(','), function(data) { this.push({ Value: data }) }, rrs);
				}
			}

			if (policy !== undefined)
				rr_set['SetIdentifier'] = v[1].set;

			switch(policy) {
				case 'weighted': rr_set['Weight'] = v[1].weight; break;
				case 'simple':
				default: break;
			}
		});

		return params;
	};

	robot.router.use(bp.json());
	// for adding and removal list of records
	robot.router.post('/route53/change', function(req, res, next) {
		var zone_finder, zone_or_record_name;
		if (req.body.zone_name !== undefined) {
			zone_finder = route53.on.zoneNamed;
			zone_or_record_name = req.body.zone_name;
		} else {
			try {
				zone_or_record_name = req.body.changes[0][1].name;
				assert.notEqual(zone_or_record_name, undefined);
			} catch (e) {
				// INVALID REQUEST
				res.send('Error: Cannot set zone from input record name and It\'s not provided neither.');
				return;
			}
			zone_finder = route53.on.hostZone;
		}
		zone_finder.call(route53.api, zone_or_record_name, function(zone) {
			req.zone = zone;
			next();
		}, function(err) {
			res.send('Error: ' + err);
		});

	}, function(req, res) {
		var changes;
		var data = req.body;
		
		var params = makeRecordsChangeParams(data.changes, req.zone);

		if (data.pretend) {
			res.send(JSON.stringify(params, null, '\t'));
			return;
		}
		return sendResourceRecordsChangeParams(params, res);
	});

	var sendResourceRecordsChangeParams = function(params, webRes) {
		route53.api.changeResourceRecordSets(params, function(err, data) {
			if (err)
				return webRes.send('Error occured ' + err);
			return webRes.send(represent.newChangeInfo(data.ChangeInfo));
		});
	};

	var criteriaTester = function(criterias) {
		var record_field;
		var checkers = [];
		for (var i = 0, len = criterias.length; i < len; i++) {

			var m = criterias[i].match(/(\S+) (==) (\S+)/i);
			if (m == null || m.indexOf(undefined) > -1)
				throw 'Invalid criteria supplied: "' + criterias[i] + '"';

			switch (m[1].toLowerCase()) {
				case 'name': path = 'Name'; break;
				case 'type': path = 'Type'; break;
				case 'set':
				case 'set_identifer': path = 'SetIdentifier'; break;
				case 'alias_target': path = 'AliasTarget.DNSName'; break;
				case 'ip': path = 'ResourceRecords[0].Value'; break;
				case 'weight': path = 'Weight'; break;
				default: throw "Invalid criteria type " + m[1];
			}
			checkers.push((function(l, op, r) {
				// currently just equality
				return function(record) { return _.get(record, l) == r; }
			}(path, m[2], m[3])));
		}

		return function(record) {
			for (var i = 0, len = checkers.length; i < len; i++) {
				if (! checkers[i](record))
					return false;
			}
			return true;
		};
	}


	var recordsToString = function(records) {
		return _.collect(records, function(r) { return represent.record(r); }).join('\n');
	};

	// records received from amazon side, though claimed, are not valid for resend;
	// fix those gotchas here.
	var normalizeRecordForResend = function(record) {
		if (record.AliasTarget !== undefined) {
			delete record['ResourceRecords'];
		}
		return record;
	};

	/*
	 * Search over records in given zone.
	 * records passing all criterias (by default no criteria) will selected and action
	 * (by defualt print) will executed on them
	 */
	robot.router.post('/route53/search', function(req, res, next) {
		if (req.body.zone_name !== undefined) {
			route53.on.zoneNamed(req.body.zone_name, function(zone) {
				req.zone = zone;
				next();
			}, function(err) {
				res.send('Error: ' + err);
			}, route53.api);
		} else {
			res.send('Error: No zone provided by zone_name');
			return;
		}
	}, function(req, res) {
		var criterias = req.body.criterias || [];
		var action, records = [];
		try {
			var tester = criteriaTester(criterias);
		} catch (e) {
			res.send('Error: Cannot make criteria evaluator, ' + e);
			return;
		}
		switch(req.body.action) {
			case undefined:
			case 'show': action = function(records) { return res.send(recordsToString(records)); }; break;
			case 'delete':
			default:
				action = function(records) { 
				var changes;
				var params = {
					HostedZoneId: req.zone.Id,
					ChangeBatch: {
						Changes: (changes = [])
					}
				};
				_.each(records, function(record) {
					normalizeRecordForResend(record);
					changes.push({
						Action: 'DELETE',
						ResourceRecordSet: record
					});
				});

				// DANGER: closure
				if (_.isArray(req.body.action)) {
					var changer = updaters[req.body.action[0]];
					assert.notEqual(changer, undefined, req.body.action[0] + " is not a defined record updater.");
					var changer_args = req.body.action.slice(1);

					_.each(records, function(record) {
						var args = _.clone(changer_args);
						args.unshift(record);
						changes.push({
							Action: 'CREATE',
							ResourceRecordSet: changer.apply(this, args)
						});
					});
				}

				if (req.body.pretend) {
					res.send(JSON.stringify(params, null, '\t'));
				} else
					sendResourceRecordsChangeParams(params, res);
			}; break;
		}

		route53.on.zoneRecords(req.zone, function(record) {
			if (tester(record)) {
				records.push(record);
			}
		}, function() {
			records = _.uniq(records);
			return action(records);
		}, {
			ctx: route53.api
		});
	});
}

var updaters = {
	set_weight: function(record, weight) {
		var new_rec = _.clone(record);
		new_rec['Weight'] = weight;
		return new_rec;
	},

	set_data: function(record, data) {
		var new_rec = _.clone(record);
		new_rec['ResourceRecords'] = [{Value: data},];
		return new_rec;
	}
};
