import { CompletionProvider } from '../src/completionProvider';
import { SymbolStore, SymbolTable } from '../src/symbol';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';

var symbolStore = new SymbolStore();
var parsedDocumentStore = new ParsedDocumentStore();
var completionProvider = new CompletionProvider(symbolStore, parsedDocumentStore, 100);
var noCompletions: lsp.CompletionList = {
    items: [],
    isIncomplete: false
};


var objectCreationSrc =
    `<?php

    /** I'm a class */
    class MyClass {
        
    }
    
    $myVar = new M
`;

var doc = new ParsedDocument('test', objectCreationSrc);
parsedDocumentStore.add(doc);
symbolStore.add(SymbolTable.create(doc));



describe('CompletionProvider', () => {

    describe('#provideCompletions()', () => {

        it('Should return empty CompletionList on no matches', function () {
            var completions = completionProvider.provideCompletions('test', { line: 5, character: 0 });
            assert.deepEqual(completions, noCompletions);
        });

        it('Should suggest object creation completions', function () {

            var expected = {
                items: [
                    {
                        label: "MyClass",
                        kind: 5,
                        detail: "MyClass",
                        documentation:"I'm a class"
                    }
                ],
                isIncomplete: false
            };
            var completions = completionProvider.provideCompletions('test', { line: 7, character: 18 });
            assert.deepEqual(completions, expected);
            console.log(JSON.stringify(completions, null, 4));
        });

    });

});