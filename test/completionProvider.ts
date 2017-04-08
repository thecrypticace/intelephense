import { CompletionProvider } from '../src/completionProvider';
import { SymbolStore, SymbolTable } from '../src/symbol';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';

var symbolStore:SymbolStore;
var parsedDocumentStore:ParsedDocumentStore;
var completionProvider:CompletionProvider;
var noCompletions: lsp.CompletionList = {
    items: [],
    isIncomplete: false
};
var doc:ParsedDocument;


var objectCreationSrc =
`<?php

    /** I'm a class */
    class MyClass {
        
    }
    
    $myVar = new M
`;

var scopedSrc = 
`<?php
    class MyClass {
        public static $myProperty = 1;
    }

    $myVar = MyClass::
`;

function setup(src:string){
    symbolStore = new SymbolStore();
    parsedDocumentStore = new ParsedDocumentStore();
    completionProvider = new CompletionProvider(symbolStore, parsedDocumentStore, 100);
    doc = new ParsedDocument('test', src);
    parsedDocumentStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
}



describe('CompletionProvider', () => {

    describe('object creation completions', () => {

        before(function(){
            setup(objectCreationSrc);
        });

        it('Should return empty CompletionList on no matches', function () {
            var completions = completionProvider.provideCompletions('test', { line: 5, character: 0 });
            assert.deepEqual(completions, noCompletions);
        });

        it('Should suggest completions', function () {

            var expected = {
                items: [
                    {
                        label: "MyClass",
                        kind: lsp.CompletionItemKind.Constructor,
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

    describe('scoped completions', () => {

        before(function(){
            setup(scopedSrc);
            //console.log(JSON.stringify(doc.tree, (k,v)=>{return k === 'children' ? undefined : v;}, 4));
        });


        it('Should suggest completions', function () {

            var expected = {
                items: [
                    {
                        label: "$myProperty",
                        kind: lsp.CompletionItemKind.Property,
                        detail: '',
                        documentation:undefined
                    }
                ],
                isIncomplete: false
            };
            var completions = completionProvider.provideCompletions('test', { line: 5, character: 22 });
            assert.deepEqual(completions, expected);
            console.log(JSON.stringify(completions, null, 4));
        });

    });

});