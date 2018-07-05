class User
    constructor: (data = {}) ->
        for k of (data or {})
            @[k] = data[k]

module.exports = User
