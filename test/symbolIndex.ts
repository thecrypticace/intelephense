import { PhpSymbol, SymbolKind, SymbolIndex } from '../src/symbol';
import { assert } from 'chai';
import 'mocha';

let symbols: PhpSymbol[] = [
    {
        kind: SymbolKind.Class,
        name: 'Foo\\MyFoo'
    },
    {
        kind: SymbolKind.Property,
        name: 'fooBar'
    },
    {
        kind: SymbolKind.Method,
        name: 'myFooFunction'
    },
    {
        kind: SymbolKind.Method,
        name: 'myBarFunction'
    },
    {
        kind: SymbolKind.Interface,
        name: 'Bar\\MyBar'
    },
    {
        kind:SymbolKind.Function,
        name: 'zoo'
    }
];

let index = new SymbolIndex();
index.addMany(symbols);

describe('SymbolIndex', () => {

    describe('#match()', () => {

        it('Should return single element array of matching item when given a unique string that exists', () => {
            let match = index.match('Foo\\MyFoo');
            assert.isArray(match);
            assert.equal(match.length, 1);
            assert.strictEqual(match[0], symbols[0]);
        });

        it('Should return correct array of matching items when given a non unique string that exists', () => {
            let match = index.match('myfoo');
            assert.isArray(match);
            assert.equal(match.length, 2);
            assert.deepEqual(match, [symbols[0], symbols[2]]);
        });

        it('Should return empty array on no matches', ()=>{
            let match = index.match('aa');
            assert.isArray(match);
            assert.lengthOf(match, 0);
        });

    });
    
});