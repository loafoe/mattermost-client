class Message {
    constructor(data) {
        if (!data) { data = {}; }
        for (let k in data) {
            this[k] = data[k];
        }
    }
}

module.exports = Message;
