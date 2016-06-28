/*
 * See route53-doc.coffee for standard module description
 *
 * Notes:
 *   Do not set Amazon credentials in local machines
 */

var _ = require('lodash');
var assert = require('assert');
var bp = require('body-parser');
var route53 = require('../lib/common');
var actions = require('../lib/actions');
var formatting = require('../lib/formatting');

// to ensure hubot -or other common deps- is in our current import path,
// even if this plugin is not installed into application's subdirectories.
module.parent.paths.forEach(function(p,i) {
	module.paths.push(p);
});
var hubot = require('hubot');
var hubot_messages = require('hubot/src/message');


module.exports = function(robot) {

	robot.respond(/route53\s+ls\s+zones\s*$/i, function(resp) {
		new route53.call(resp, {action: 'ls_zones'}, {}).do_action();
	});

	robot.respond(/route53\s+show\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp, {action: 'show_zone'}, {zone_name: resp.match[1]}).do_action();
	});

	robot.respond(/route53\s+ls\s+(\S+)\s+records\s*$/i, function(resp) {
		new route53.call(resp, {action: 'ls_zone_records'}, {zone_name: resp.match[1]}).do_action();
	});

	robot.respond(new RegExp('route53\\s+(add|create|append|remove|delete)' +
			'(?:\\s+(\\d+)\\s+weighted)?' + 
			'(?:\\s+in\\s+(?:(AF|AN|AS|EU|OC|NA|SA)|(?:(\\S{2}):(\\S+)?)))?' +
			'\\s+record(?:\\s+set\\s+(\\S+))?' +
			'\\s+(\\S+)\\s+' + formatting.patterns.valid_types +
			'(?:' +
				'(?:\\s+alias\\s+for\\s+(\\S+)((?:\\s+(don\'t|not|do not))?\\s+check\\s+target\\s+health)?)' +
			'|' +
				'(?:\\s+(\\d+)\\s+(\\S.+))' +
			')\\s*$', 'i'),
		function(resp) {
			var args = {
				action: resp.match[1],
				record: {
					weight: resp.match[2],
					continent: resp.match[3],
					country: resp.match[4],
					subdivision: resp.match[5],
					set: resp.match[6],
					name: resp.match[7],
					type: resp.match[8].toUpperCase(),
					ttl: resp.match[12],
					data: resp.match[13],
					alias_target: resp.match[9],
					check_target_health: Boolean(resp.match[10] && ! resp.match[11]),
				}
			};
			new route53.call(resp, {action: 'add_remove_record'}, args).do_action();
		}
	);

	robot.respond(/route53\s+show\s+change\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp).getChange({ Id: resp.match[1] }, function(err, data) {
			return err ? resp.reply('Error: ' + err) : resp.reply(formatting.represent.storedChangeInfo(data.ChangeInfo));
		});
	});

	robot.respond(/route53\s+create\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp, {action: 'create_zone'}, {
			command: resp.match[0],
			zone_name: resp.match[1]
		}).do_action();
	});

	robot.respond(/route53\s+show\s+records?\s+(.+)\s*$/i, function(resp) {
		new route53.call(resp, {action: 'show_records'}, resp.match[1]).do_action();
	});


	robot.respond(/route53\s+update\s+record\s+(.*)\s+set\s+(?:weight\s+to\s+(\d+)|data\s+to\s+(\S+))\s*$/i, function(resp) {
		var m, args = {};
		
		if (m = resp.match[1].match(
				new RegExp('^aliased to '+formatting.patterns.name_maybe_with_type, 'i'))) {

			args.alias_lookup = true;

		} else if (m = resp.match[1].match(new RegExp(formatting.patterns.name_maybe_with_type, 'i'))) {

			args.alias_lookup = false;

		} else {

			resp.reply('Dude.. You invoking me badly.. see examples.');
			return;

		};

		args.record_name = m[1];
		args.record_type = m[2];
		args.new_weight= resp.match[2];
		args.new_data= resp.match[3];
		args.command = resp.match[0];

		new route53.call(resp, {action: 'update_record'}, args).do_action();
	});

	robot.respond(/route53\s+delete\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp, {action: 'delete_zone'}, {zone_name: resp.match[1]}).do_action();
	});

	robot.respond(/route53\s+examples?\s*$/i, function(resp) {
		resp.reply('Add plain resource record:' + '\n' +
		           '> route53 add record www.zone.tld A 60 192.168.23.11' + '\n' +
		           'Add weighted resource record with set identifier 10wset:' + '\n' +
		           '> route53 add 10 weighted record set 10wset w10.zone.tld A 60 192.122.12.13' + '\n' +
		           'Add aliased weighted resource record set' + '\n' +
		           '> route53 add 15 weighted record set web www.zone.tld A alias for w15.zone.tld check target health\n' + '\n' +
		           'Changes will observabe instantly by printing zone records: ' + '\n' +
		           '> route53 ls zone.tld records' + '\n' +
		           'Show details of records' + '\n' +
		           '> route53 show record www.zone.tld' + '\n' +
		           'Or if there are many records defined, a more selective one:' + '\n' +
		           '> route53 show records aliased to w15.zone.tld' + '\n' +
		           'Or more selective: ' + '\n' +
		           '> route53 show records aliased to w15.zone.tld A\n' + '\n' +
		           'It show records by changed state, but in fact changes are not fully operational until state become INSYNC' + '\n' +
		           '> route53 show change C12UGSTBO1H3B2\n' + '\n' +
		           'To update weight of some record:' + '\n' +
		           '> route53 update record www.zone.tld A set weight to 5' + '\n' +
		           'Record types are optional if it result to single record.' + '\n' +
		           'Weighted alias resource record sets are not different:' + '\n' +
		           '> route53 update record w10.zone.tld A set weight to 1' + '\n' +
		           'Also, It can be selected by It\'s target record:' + '\n' +
		           '> route53 update record aliased to w15.zone.tld set weight to 0' + '\n' +
		           'Notice: Update will not work for multiple records' + '\n' +
		           'Add geo records in North America:' + '\n' +
		           '> route53 add in NA record set na-w3 w3.na.zone.tld A 80 192.122.12.13' + '\n' +
		           'Or for Canada:' + '\n' +
		           '> route53 add in CA: record set ca-w3 w3.ca.zone.tld A 80 192.122.12.13');
	});

	robot.listeners.push(
		new hubot.Listener(robot,
			                 function(msg) {
			                 	return msg instanceof hubot_messages.CatchAllMessage
			                 		&& new RegExp(robot.name + '\\s+route53 ?.*', 'i').test(msg.message.text);
			                 },
			                 function(resp) {
			                 	resp.reply('Bad route53 command invocation');
			                 })
	);

	robot.router.use(bp.json());

	// for adding and removal list of records
	robot.router.post('/route53/change', function(req, res, next) {
		req.api_caller = new route53.call(res, {action: 'extract_zone_api'}, {
			request: req, response: res, next: next
		});
		req.api_caller.do_action();
	}, actions.web_change_records);

	/*
	 * Search over records in given zone.
	 * records passing all criterias (by default no criteria) will selected and action
	 * (by defualt print) will executed on them
	 */
	robot.router.post('/route53/search', function(req, res, next) {
		req.api_caller = new route53.call(res, {action: 'search_records_api'}, {
			request: req, response: res, next: next
		});
		req.api_caller.do_action();
	}, actions.web_search_records);
}
