/*
 * decaffeinate suggestions:
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
class Message {
    constructor(data) {
        if (data == null) { data = {}; }
        for (let k in (data || {})) {
            this[k] = data[k];
        }
    }
}

module.exports = Message;
