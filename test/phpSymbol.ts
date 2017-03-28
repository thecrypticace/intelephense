import { PhpSymbol, SymbolKind } from '../src/symbol';
import { assert } from 'chai';
import 'mocha';

describe('PhpSymbol', () => {

    describe('#acronym()', () => {

        it('Should return correct acronym for camel case fqn', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Class,
                name:'Foo\\MyFooClass'
            } 
            assert.equal(PhpSymbol.acronym(s), 'mfc');
        });

        it('Should return correct acronym for lower case underscore separated name', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Function,
                name:'_my_function'
            } 
            assert.equal(PhpSymbol.acronym(s), 'mf');
        });

        it('Should return correct acronym for camel case variable/property', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Variable,
                name:'$myProperty'
            } 
            assert.equal(PhpSymbol.acronym(s), 'mp');
        });

        it('Should return correct acronym for upper case underscore separated name', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Variable,
                name:'THIS_IS_A_CONSTANT'
            } 
            assert.equal(PhpSymbol.acronym(s), 'tiac');
        });

    });

    describe('#suffixArray()', () => {

        it('Should return correct suffixes for camel case fqn', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Class,
                name:'Foo\\MyFooClass'
            }

            let expected = [
                'foo\\myfooclass',
                'myfooclass',
                'fooclass',
                'class'
            ];

            assert.deepEqual(PhpSymbol.suffixArray(s), expected);
        });

        it('Should return correct suffixes for lower case underscore separated name', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Function,
                name:'_my_function'
            } 

            let expected = [
                '_my_function',
                'my_function',
                'function'
            ];

            assert.deepEqual(PhpSymbol.suffixArray(s), expected);
        });

        it('Should return correct suffixes for camel case variable/property', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Variable,
                name:'$myProperty'
            } 

            let expected = [
                '$myproperty',
                'myproperty',
                'property'
            ];

            assert.deepEqual(PhpSymbol.suffixArray(s), expected);
        });

        it('Should return correct suffixes for upper case underscore separated name', () => {
            let s:PhpSymbol = {
                kind:SymbolKind.Variable,
                name:'THIS_IS_A_CONSTANT'
            } 

            let expected = [
                'this_is_a_constant',
                'is_a_constant',
                'a_constant',
                'constant'
            ];

            assert.deepEqual(PhpSymbol.suffixArray(s), expected);
        });

    });
    
});