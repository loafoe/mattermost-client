class Message {
    constructor(data = {}) {
        const initMessageData = key => {
            this[key] = key;
        };

        Object.keys(data).forEach(initMessageData);
    }
}

module.exports = Message;
