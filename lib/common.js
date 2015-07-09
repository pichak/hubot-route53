/*
 * Common functionalities for calling route53 methods
 */

var _ = require('lodash');
var assert = require('assert');
var AWS = require('aws-sdk');
var actions = require('./actions');
var zoneHelpers = require('./zone-helpers');

AWS.config = {
	"accessKeyId": process.env.AWS_ACCESS_KEY_ID,
	"secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY
};


var aws_route53 = new AWS.Route53({apiVersion: '2013-04-01'});

var APICall = function(response, options, action_args) {
	var options = options || {};
	var _data = {};

	_.each(zoneHelpers, function(func, name) {
		if(typeof func === 'function')
			this[name] = function() { return func.apply(this, arguments); };
		}, this);

	this.defaultErrorHandler = function(message) {
		response.send('Error: ' + message);
	};

	this.data = function(name, value) {
		return arguments.length == 2 ? (_data[name] = value, this) : _data[name];
	};

	this.unset = function(name) {
		delete _data[name];
	};

	this.clear = function() {
		_data = {};
	};

	this.do_action = function() {
		if (! this.prevented)
			actions[options.action](this, action_args);
	}

	this.response = response;
	this.prevented = false; // prevent sending requests to aws

	var pre_call_chain = lib_config.pre_call_chains[options.action];
	if (pre_call_chain == undefined)
		pre_call_chain = lib_config.pre_call_chains['*'];
	if (pre_call_chain && pre_call_chain.length) {
		pre_call_chain[0].call(this, options, lib_config, action_args, pre_call_chain[1]);
	}

	if (this.prevented && options.action == undefined) {
		// shadow aws_api methods
		_.each(aws_route53.api.operations, function(m, k) { this[k] = new Function(); }, this);
	} 
};

APICall.prototype = aws_route53;

// placeholder for configuration from library user
var lib_config = {
	pre_call_chains: {
		/*
		 * action: [
		 *   functions ...
		 * ]
		 */
	}
}; 

module.exports = {
	call: APICall,
	on: zoneHelpers,
	api: aws_route53,
	configure: function(config) { lib_config = config; },
};
