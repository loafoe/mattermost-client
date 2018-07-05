class Message
    constructor: (data = {}) ->
        for k of (data or {})
            @[k] = data[k]

module.exports = Message
