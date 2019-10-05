class User {
    constructor(data) {
        if (!data) { data = {}; }
        for (const k in data) {
            this[k] = data[k];
        }
    }
}

module.exports = User;
