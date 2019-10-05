class User {
    constructor(data = {}) {
        const initUserData = key => {
            this[key] = key;
        };

        Object.keys(data).forEach(initUserData);
    }
}

module.exports = User;
