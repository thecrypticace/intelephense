import { Context } from '../src/context';
import { SymbolStore } from '../src/symbolStore';
import { ParsedDocument } from '../src/parsedDocument';
import { Position } from 'vscode-languageserver-types';
import { Token, TokenType } from 'php7parser';
import { assert } from 'chai';
import 'mocha';

var src =
    `<?php
    namespace MyNs;
    
    $myVar = 1;

    function myFunction(){

    }
`;

var symbolStore = new SymbolStore();
var doc = new ParsedDocument('test', src);
var position: Position = {
    line: 5,
    character: 14
};
var context: Context;

describe('Context', () => {

    describe('#create', function () {

        it('Should create a context', function (done) {
            context = new Context(symbolStore, doc, position);
            assert.isOk(context);
            done();
        });

        it('Should initialise with the correct position', function () {
            assert.equal((<Token>context.spine[context.spine.length - 1]).tokenType, TokenType.Name);
            assert.equal(doc.tokenText(<Token>context.spine[context.spine.length - 1]), 'myFunction');
        });

    });

});