class User {
    constructor(data) {
        if (!data) { data = {}; }
        for (let k in (data || {})) {
            this[k] = data[k];
        }
    }
}

module.exports = User;
