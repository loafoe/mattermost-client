class User {
    constructor(data = {}) {
        Object.keys(data)
            .forEach((k) => { this[k] = data[k]; });
    }
}

module.exports = User;
