import { Intelephense } from '../src/intelephense';
import { assert } from 'chai';
import 'mocha';

describe('intelephense', function(){

    describe('#initialise', function(){

        it('built in symbols', function(){

            Intelephense.initialise();
            assert.isAbove(Intelephense.numberSymbolsKnown(), 1);

        });

    });


});