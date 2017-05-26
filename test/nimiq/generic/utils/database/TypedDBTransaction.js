class TypedDBTransaction {
    constructor(db) {
        this._db = db;
        this._objects = {};
        this._strings = {};
        this._deletions = {};
    }

    commit() {
        return this._db.nativeTransaction().then( tx => new Promise( (resolve, reject) => {
            tx.on('complete', () => {
                if (this._db.updateCache && this._db.flushCache) {
                    this._db.updateCache(this._objects);
                    this._db.updateCache(this._strings);
                    this._db.flushCache(Object.keys(this._deletions));
                }

                resolve(true);
            });
            tx.on('error', e => reject(e));

            for (let key in this._objects) {
                tx.putObject(key, this._objects[key]);
            }
            for (let key in this._strings) {
                tx.putString(key, this._strings[key]);
            }
            for (let key in this._deletions) {
                tx.delete(key);
            }

            tx.commit();
        }));
    }

    async getObject(key) {
        if (this._deletions[key]) return undefined;
        if (this._objects[key] !== undefined) return this._objects[key];
        return await this._db.getObject(key);
    }

    putObject(key, value) {
        this._objects[key] = value;
        delete this._deletions[key];
    }

    async getString(key) {
        if (this._deletions[key]) return undefined;
        if (this._strings[key] !== undefined) return this._strings[key];
        return await this._db.getString(key);
    }

    putString(key, value) {
        this._strings[key] = value;
        delete this._deletions[key];
    }

    delete(key) {
        this._deletions[key] = true;
        delete this._objects[key];
        delete this._strings[key];
    }
}
Class.register(TypedDBTransaction);
