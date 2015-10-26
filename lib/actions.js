var _ = require('lodash');
var assert = require('assert');
var formatting = require('./formatting');

// records received from amazon side, though claimed, are not valid for resend;
// fix those gotchas here.
var normalizeRecordForResend = function(record) {
	if (record.AliasTarget !== undefined) {
		delete record['ResourceRecords'];
	}
	return record;
};

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


var recordsToString = function(records) {
	return _.collect(records, function(r) { return formatting.represent.record(r); }).join('\n');
};



var sendResourceRecordsChangeParams = function(api_caller, params, webRes) {
	api_caller.changeResourceRecordSets(params, function(err, data) {
		if (err)
			return webRes.send('Error occured ' + err);
		return webRes.send(formatting.represent.newChangeInfo(data.ChangeInfo));
	});
};

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
		var rr_set, rrs, change;

		switch(v[0] && v[0].toLowerCase()) {
			case 'add':
			case 'create':
			case 'append': action = 'CREATE'; break;
			case 'remove':
			case 'delete': action = 'DELETE'; break;
			default: throw new Error("Unknown action " + v[0]);
		};

		var is_simple = v[1].continent === undefined &&
										v[1].country === undefined   &&
										v[1].weight === undefined;

		assert.equal(is_simple, v[1].set === undefined, 
								 "non-simple policy needs set identifier");

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

		if (! is_simple)
			rr_set['SetIdentifier'] = v[1].set;
		
		if (v[1].continent)
			rr_set['GeoLocation'] = {'ContinentCode': v[1].continent};
		
		if (v[1].country) {
			assert.equal(v[1].continent, undefined, "continent code is not meaningful with country");
			rr_set['GeoLocation'] = {'CountryCode': v[1].country};
			if (v[1].subdivision) {
				assert.notEqual(v[1].country, undefined,
												"subdivision code is just meaningful within country");
				rr_set['GeoLocation']['SubdivisionCode'] = v[1].subdivision;
			}
		}

		if (v[1].weight)
			rr_set['Weight'] = v[1].weight;
	});

	return params;
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

module.exports = {
	add_remove_record: function(api_caller, args) {
		var record = args.record, action = args.action;

		api_caller.hostZone(record.name, function(zone) {
			try {
				var params = makeRecordsChangeParams([[action, record],], zone);
			} catch (e) {
				api_caller.response.send('Error: ' + e);
				return;
			}

			this.changeResourceRecordSets(params,
				function(err, data) {
					if (err) {
						api_caller.response.send('Error occured ' + err);
						return;
					}
					return api_caller.response.send(formatting.represent.newChangeInfo(data.ChangeInfo));
			});
		});
	},

	create_zone: function(api_caller, args) {
		api_caller.createHostedZone({
			CallerReference: args.zone_name + new Date().getTime(),
			Name: args.zone_name,
			HostedZoneConfig: {
				Comment: 'Made by ' + args.command
			}
		}, function(err, data) {
			if (err) return api_caller.response.send('Error: ' + err);
			api_caller.response.send(formatting.represent.newChangeInfo(data.ChangeInfo));
			api_caller.response.send(formatting.represent.zone(data.HostedZone));
		});
	},

	delete_zone: function(api_caller, args) {
		api_caller.zoneNamed(args.zone_name, function(zone) {
			this.deleteHostedZone({
				Id: zone.Id
			}, function(err, data) {
				if (err) return api_caller.response.send('Error: ' + err);
				return api_caller.response.send(formatting.represent.newChangeInfo(data.ChangeInfo));
			});
		});
	},

	ls_zones: function(api_caller) {
		api_caller.listHostedZones({}, function(err, data) {
			if (err) return this.request.service.defaultErrorHandler(err);

			return api_caller.response.send(
				_.collect(data.HostedZones, function(zone) {
					return zone.Name;
				}).join("\n")
			);

		});
	},

	ls_zone_records: function(api_caller, args) {
		api_caller.zoneNamed(args.zone_name, function(zone) {
			this.list = [];
			this.zoneRecords(zone, function(record) {
					this.list.push(formatting.represent.record(record));
				}, function() {
					api_caller.response.send(_.uniq(this.list).join('\n'));
					delete this.list;
				});
		});
	},

	show_records: function(api_caller, select_str) {
		var m, name, type, selector;

		if (m = select_str.match(
				new RegExp('aliased to ' + formatting.patterns.name_maybe_with_type, 'i'))) {

			var selector = function(record) {
				return record.AliasTarget && record.AliasTarget.DNSName === name
						&& (record.Type === type || type === undefined);
			};
		} else if (m = select_str.match(
				new RegExp(formatting.patterns.name_maybe_with_type, 'i'))) {

			var selector = function(record) {
				return record.Name === name && (record.Type === type || type === undefined)
			}
		} else {
			return resp.reply('Invalid invocation of show records.');
		}

		name = m[1];
		type = m[2];
		if (! _.endsWith(name, '.')) name += '.';

		api_caller.data('records', []).hostZone(name, function(zone) {
			this.zoneRecords(zone, function(record) {
					this.data('records').push(formatting.represent.record(record));
				}, function() {
					var results = _.uniq(this.data('records'));
					this.unset('records');
					this.response.send(results.length ? results.join('\n') : 'No record found');
				}, {
					predicate: selector
				}
			);
		});
	},

	show_zone: function(api_caller, args) {
		api_caller.zoneNamed(args.zone_name, function(zone) {
				api_caller.response.send(formatting.represent.zone(zone));
		});
	},

	update_record: function(api_caller, args) {
		api_caller.resourceRecord({ Name: args.record_name, Type: args.record_type }, function(r) {

			this.recordOrItsAlias(r, args.alias_lookup, function(actual_record) {
				var new_record;

				normalizeRecordForResend(actual_record);
				if (args.new_weight != undefined)
					new_record = updaters.set_weight(actual_record, args.new_weight);
				else if (args.new_data != undefined)
					new_record = updaters.set_data(actual_record, args.new_data);
				else {
					api_caller.response.send('No known action for update.');
					return;
				}

				this.changeResourceRecordSets({
					HostedZoneId: this.zone.Id,
					ChangeBatch: { Changes: [
						{ Action: 'DELETE', ResourceRecordSet: actual_record },
						{ Action: 'CREATE', ResourceRecordSet: new_record }
					], Comment: args.command
					}
				}, function(err, data) {
					if (err)
						api_caller.response.send('Error: ' + err.message);
					else
						api_caller.response.send(formatting.represent.newChangeInfo(data.ChangeInfo));
				});
			});
		}, undefined, {singleResultExpected: ! args.alias_lookup });
	},

	extract_zone_api: function(api_caller, args) {
		var req = args.request, res = args.response, next = args.next;
		var zone_finder, zone_or_record_name;
		if (req.body.zone_name !== undefined) {
			zone_finder = api_caller.zoneNamed;
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
			zone_finder = api_caller.hostZone;
		}
		zone_finder.call(api_caller, zone_or_record_name, function(zone) {
			req.zone = zone;
			next();
		}, function(err) {
			res.send('Error: ' + err);
		});
	},

	web_change_records: function(req, res, next) {
		var changes;
		var data = req.body;
		
		var params = makeRecordsChangeParams(data.changes, req.zone);

		if (data.pretend) {
			res.send(JSON.stringify(params, null, '\t'));
			return;
		}
		return sendResourceRecordsChangeParams(req.api_caller, params, res);
	},

	search_records_api: function(api_caller, args) {
		var req = args.request, res = args.response, next = args.next;
		if (req.body.zone_name !== undefined) {
			api_caller.zoneNamed(req.body.zone_name, function(zone) {
				req.zone = zone;
				next();
			}, function(err) {
				res.send('Error: ' + err);
			});
		} else {
			res.send('Error: No zone provided by zone_name');
			return;
		}
	},

	web_search_records: function(req, res, next) {
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
					sendResourceRecordsChangeParams(req.api_caller, params, res);
			}; break;
		}

		req.api_caller.zoneRecords(req.zone, function(record) {
			if (tester(record)) {
				records.push(record);
			}
		}, function() {
			records = _.uniq(records);
			return action(records);
		});
	}
};
