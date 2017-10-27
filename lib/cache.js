/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const mkdirp = require("mkdirp");
const path = require("path");
const util = require("./util");
function createCache(path) {
    return new FileCache(path);
}
exports.createCache = createCache;
function writeFile(filePath, bucket) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(bucket), (err) => {
            if (err) {
                reject(err.message);
                return;
            }
            resolve();
        });
    });
}
function deleteFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                reject(err.message);
                return;
            }
            resolve();
        });
    });
}
function readFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(undefined);
                }
                else {
                    reject(err.message);
                }
                return;
            }
            resolve(JSON.parse(data.toString()));
        });
    });
}
function bucketFind(bucket, key) {
    return bucket.find((i) => { return i[0] === key; });
}
function bucketRemove(bucket, key) {
    return bucket.filter((b) => { return b[0] !== key; });
}
class FileCache {
    constructor(path) {
        this.path = path;
    }
    init() {
        let dir = this.path;
        return new Promise((resolve, reject) => {
            mkdirp(dir, (err) => {
                if (err && err.code !== 'EEXIST') {
                    reject(err.message);
                    return;
                }
                resolve();
            });
        });
    }
    read(key) {
        let filePath = this._filePath(key);
        return readFile(filePath).then((b) => {
            let item;
            if (b && (item = bucketFind(b, key))) {
                return Promise.resolve(item[1]);
            }
            else {
                return Promise.resolve(undefined);
            }
        });
    }
    write(key, data) {
        let filePath = this._filePath(key);
        return readFile(filePath).then((b) => {
            if (b) {
                b = bucketRemove(b, key);
                b.push([key, data]);
            }
            else {
                b = [[key, data]];
            }
            return writeFile(filePath, b);
        });
    }
    delete(key) {
        let filePath = this._filePath(key);
        return readFile(filePath).then((b) => {
            let item;
            if (b && bucketFind(b, key) && b.length > 1) {
                b = bucketRemove(b, key);
                return writeFile(filePath, b);
            }
            else if (b) {
                return deleteFile(filePath);
            }
            else {
                return Promise.resolve();
            }
        });
    }
    _filePath(key) {
        return path.join(this.path, Math.abs(util.hash32(key)).toString(16));
    }
}
exports.FileCache = FileCache;
