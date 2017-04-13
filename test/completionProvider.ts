import { CompletionProvider } from '../src/completionProvider';
import { SymbolStore, SymbolTable } from '../src/symbol';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';

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

var nameSrc = 
`<?php
    a
`;

var openTagSrc = 
`<?p
`;

function setup(src:string){
    let symbolStore = new SymbolStore();
    let parsedDocumentStore = new ParsedDocumentStore();
    let completionProvider = new CompletionProvider(symbolStore, parsedDocumentStore, 100);
    let doc = new ParsedDocument('test', src);
    parsedDocumentStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
    return completionProvider;
}

function inbuiltSetup(src:string){
    let symbolStore = new SymbolStore();
    let parsedDocumentStore = new ParsedDocumentStore();
    let completionProvider = new CompletionProvider(symbolStore, parsedDocumentStore, 100);
    let doc = new ParsedDocument('test', src);
    parsedDocumentStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
    symbolStore.add(SymbolTable.createBuiltIn());
    return completionProvider;
}

describe('CompletionProvider', () => {

    describe('object creation completions', () => {

        let completionProvider:CompletionProvider;
        before(function(){
            completionProvider = setup(objectCreationSrc);
        });

        it('Should return empty CompletionList on no matches', function () {
            var completions = completionProvider.provideCompletions('test', { line: 5, character: 0 });
            assert.deepEqual(completions, noCompletions);
        });

        it('Should suggest completions', function () {

            var completions = completionProvider.provideCompletions('test', { line: 7, character: 18 });
            //console.log(JSON.stringify(completions, null, 4));
            assert.equal(completions.items[0].label, 'MyClass');
            assert.equal(completions.items[0].kind, lsp.CompletionItemKind.Constructor);
            
        });

    });

    describe('scoped completions', () => {

        let completionProvider:CompletionProvider;

        before(function(){
            completionProvider = setup(scopedSrc);
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
        
        let completionProvider:CompletionProvider;
        before(function(){
            completionProvider = setup(variableSrc);
        });

        it('variable completions from correct scope', function(){
            var completions = completionProvider.provideCompletions('test', { line: 8, character: 5 });
            //console.log(JSON.stringify(completions, null, 4));
        });
    });


    describe('name completions', function(){

        let completionProvider:CompletionProvider;
        before(function(){
            completionProvider = inbuiltSetup(nameSrc);
        });

        it('name completions', function(){
            var completions = completionProvider.provideCompletions('test', { line: 1, character: 5 });
            //console.log(JSON.stringify(completions, null, 4));
        });

    });


});