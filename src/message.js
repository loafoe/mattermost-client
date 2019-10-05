class Message {
    constructor(data) {
        if (!data) { data = {}; }
        for (const k in data) {
            this[k] = data[k];
        }
    }
}

module.exports = Message;
