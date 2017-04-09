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

    $myVar = MyClass::$m
`;

var variableSrc = 
`<?php
    class MyClass {
        function myFn(){ 
            $myFnVar = 1;
        }
    }

    $myVar = new MyClass();
    $
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

            var completions = completionProvider.provideCompletions('test', { line: 7, character: 18 });
            console.log(JSON.stringify(completions, null, 4));
            assert.equal(completions.items[0].label, 'MyClass');
            assert.equal(completions.items[0].kind, lsp.CompletionItemKind.Constructor);
            
        });

    });

    describe('scoped completions', () => {

        before(function(){
            setup(scopedSrc);
            //console.log(JSON.stringify(symbolStore, null, 4));
        });


        it('Should suggest completions on $', function () {

            var completions = completionProvider.provideCompletions('test', { line: 5, character: 23 });
            assert.equal(completions.items[0].label, '$myProperty');
            assert.equal(completions.items[0].kind, lsp.CompletionItemKind.Property);
            //console.log(JSON.stringify(completions, null, 4));
        });

        it('Should suggest completions on :', function () {

            var completions = completionProvider.provideCompletions('test', { line: 5, character: 22 });
            assert.equal(completions.items[0].label, '$myProperty');
            assert.equal(completions.items[0].kind, lsp.CompletionItemKind.Property);
            //console.log(JSON.stringify(completions, null, 4));
        });

        it('Should suggest completions on $m', function () {

            var completions = completionProvider.provideCompletions('test', { line: 5, character: 24 });
            assert.equal(completions.items[0].label, '$myProperty');
            assert.equal(completions.items[0].kind, lsp.CompletionItemKind.Property);
            //console.log(JSON.stringify(completions, null, 4));
        });

    });

    describe('variable completions', function(){
        before(function(){
            setup(variableSrc);
        });

        it('variable completions from correct scope', function(){
            var completions = completionProvider.provideCompletions('test', { line: 8, character: 5 });
            console.log(JSON.stringify(completions, null, 4));
        });
    })

});