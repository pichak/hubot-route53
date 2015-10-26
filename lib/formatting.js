var _ = require('lodash');

module.exports = {
	patterns: {
		name_maybe_with_type: '(\\S+)(?:\\s+(\\S+))?', // actual types not expressed with reason
		valid_types: '(SOA|AAAA|A|TXT|NS|CNAME|MX|PTR|SRV|SPF)'
	},

	represent: {
		record: _.template('<%=Name%>\t<%=Type%>\t' +
		'<% if (typeof AliasTarget == "undefined") { %>' +
			'<%= TTL %>\t' +
			'<%= _.collect(ResourceRecords, function(rr) { return rr.Value }) %>\t' +
		'<%} else {%>' +
			'alias_for=<%= AliasTarget.DNSName %> ' +
			'evaluate_target_health=<%= AliasTarget.EvaluateTargetHealth %> ' +
		'<%} %>' +
		'<% if (typeof Weight != "undefined") print("weight="+Weight+" ") %>' +
    '<% if (typeof GeoLocation != "undefined")' +
      'print("location=" + (GeoLocation.ContinentCode || "*") +' +
             '"," + (GeoLocation.CountryCode || "*") +' +
             '"," + (GeoLocation.SubdivisionCode || "*") + " "' +
       ') %>' +
		'<% if (typeof SetIdentifier != "undefined") print("set="+SetIdentifier+" ") %>'),
		newChangeInfo: _.template('Created change <%= Id %>. Current status: <%= Status %>'),
		storedChangeInfo: _.template('Submitted at <%= SubmittedAt %>\nCurrent Status: <%= Status %>'),
		zone: _.template('<%= Name %> [#<%= Id %>] has <%= ResourceRecordSetCount %> records.')
	}
};
