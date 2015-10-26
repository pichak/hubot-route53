###
# Description:
#    Interaction with route53
#
# Dependencies:
#   "aws-sdk"
#   "lodash
# 
# Configuration:
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
# 
# Commands:
#   hubot route53 ls zones - get list of our defined zones
#   hubot route53 ls <zone_name> records - get records defined in zone
#   hubot route53 show zone <zone_name> - one line description of defined zone
#   hubot route53 show record[s] [aliased to] <name> [<type>] - get list of records matching criteria
#   hubot route53 show change <change_info_id> - tell status of change info
#   hubot route53 add|remove record <name> <type> <ttl> <data>,... - add or remove simple resource record
#   hubot route53 add|remove <weight> weighted record set <set_id> <name> <type> <ttl> <data> - add weighted resource record
#   hubot route53 add|remove record <name> <type> alias for <target_name> <target_type> [don't] check target health - add alias rr
#   hubot route53 add in <continent> record set <set_id> <name> <type> <ttl> <data> - add geo resource record
#   hubot route53 add in <country>:[subdivision] record set <set_id> <name> <type> <ttl> <data> - add geo resource record
#   hubot route53 update record [aliased to] <name> [<type>] set weight to <new_weight> - update resource record weight
#   hubot route53 update record <name> [<type>] set data to <new_data> - update resource record data
#   hubot route53 create zone <zone_name> - create zone
#   hubot route53 delete zone <zone_name> - delete zone
#   hubot route53 examples - show some examples
# 
# Notes:
#   Do not set Amazon credentials in local machines
# 
# Author:
#   reith
###

module.exports = (robot) ->
