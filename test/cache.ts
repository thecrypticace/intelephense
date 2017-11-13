import { assert } from 'chai';
import 'mocha';
import {readArrayFromDisk, writeArrayToDisk} from '../src/cache';


describe('jsonstream read and write json file', () => {

    let path = '/tmp/test_intelephense_cache.json';
    let items: any[] = [];
    
    for (let n = 0; n < 10000; ++n) {
        items.push(Math.floor(Math.random() * 1000000).toString(16));
    }

    it('write and read', () => {

        return writeArrayToDisk(items, path).then(() => {

            return readArrayFromDisk(path).then((data)=>{
                //console.log(JSON.stringify(data, null, 4));
                assert.lengthOf(data,10000);
            });

        });

    });

});