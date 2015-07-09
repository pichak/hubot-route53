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

	robot.respond(new RegExp('route53\\s+(add|create|append)' +
			'(?:\\s+(\\d+))?' + // policy options, currently just weighted
			'(?:\\s+(weighted|simple))?' +
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
					policy: resp.match[3] && resp.match[3].toLowerCase(),
					set: resp.match[4],
					name: resp.match[5],
					type: resp.match[6].toUpperCase(),
					ttl: resp.match[10],
					data: resp.match[11],
					alias_target: resp.match[7],
					check_target_health: Boolean(resp.match[8] && ! resp.match[9]),
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

		var args = {
			record_name: m[1],
			record_type: m[2],
			new_weight: resp.match[2],
			new_data: resp.match[3],
			command: resp.match[0]
		};

		new route53.call(resp, {action: 'update_record'}, args).do_action();
	});

	robot.respond(/route53\s+delete\s+zone\s+(\S+)\s*$/i, function(resp) {
		new route53.call(resp, {action: 'delete_zone'}, {zone_name: resp.match[1]}).do_action();
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
