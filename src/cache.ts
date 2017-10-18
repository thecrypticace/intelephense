/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as util from './util';

export interface Cache {
    init(): Promise<void>;
    read(key: string): Promise<any>;
    write(key: string, data: any);
    delete(key: string);
}

export class FileCache implements Cache {

    constructor(private path: string) { }

    init() {
        let dir = this.path;
        return new Promise<void>((resolve, reject) => {
            mkdirp(dir, (err) => {
                if (err && err.code !== 'EEXIST') {
                    reject(err.message);
                }
                resolve();
            });
        });
    }

    read(key: string) {

        let filePath = this._filePath(key);
        return new Promise<any>((resolve, reject) => {

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        resolve(undefined);
                    } else {
                        reject(err.message);
                    }
                    return;
                }
                resolve(JSON.parse(data.toString()));
            });

        });

    }

    private _filePath(key: string) {
		return path.join(this.path, this._hash(key));
    }

    private _fileName(key:string) {
        let hash = util.hash32(key);
        let partialString = key.replace(/\W/g, '').slice(-50);
        if(hash < 0) {
            
        }
        
    }


}