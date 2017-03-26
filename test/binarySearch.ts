import { BinarySearch } from '../src/types';
import { assert } from 'chai';
import 'mocha';

let array = [1, 2, 2, 4, 7, 9, 12, 13, 14, 20, 30, 32, 35, 36, 39, 40, 41, 41, 100];
let search = new BinarySearch<number>(array);

describe('BinarySearch', () => {

    describe('#find()', () => {

        it('Should find value when present', function () {
            assert.equal(search.find((n) => { return n - 12; }), 12);
        });

        it('Should return null when not present', function () {
            assert.isNull(search.find((n) => { return n - 37; }));
        });

    });

    describe('#rank()', function () {

        it('Should get rank of value if exists', function () {
            assert.equal(search.rank((n) => { return n - 14; }), 8);
        });

        it('Should rank value in correctorder when not exists', function () {
            assert.equal(search.rank((n) => { return n - 6; }), 4);
        });

        it('Should get array length when value does not exists and is the largest value', function () {
            assert.equal(search.rank((n) => { return n - 6200; }), array.length);
        });

    });

    
});