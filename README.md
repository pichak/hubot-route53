Starting
========

This plugin read Amazon AWS API access key and secret key from
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` respectively.


Configuration
=============

Using APICall method invocation, Each action could configured by exported
`configure` method from `lib/common` module.  Configuration may have
`pre_call_chains` object in the form of key and values of action name and
callback functions list, respectively.  Callback functions will called with
four arguments: options of values defined in plugin, plugin configurations,
arguments will being passed to action and next function in callack chain which
should explicitly called.

This may used for defining ACL before command executions or manipulating action
arguments before process:

```coffeescript
route53.configure {
	needed_roles: {
		create_zone: 'maintainer',
	},
	pre_call_chains: {
		'*': [
			(call_options, user_options, action_options, next_callback) ->
				if ! this.response.message.user.hasRole 'maintainer'
					this.prevented = true
				else
					next_callback()
		]
	}
}
```
