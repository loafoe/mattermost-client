class User {
    constructor(data = {}) {
        Object.keys(data).forEach((key) => {
            this[key] = key;
        });
    }
}

module.exports = User;
