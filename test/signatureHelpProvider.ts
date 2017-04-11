import { SignatureHelpProvider } from '../src/signatureHelpProvider';
import { SymbolStore, SymbolTable, SymbolKind } from '../src/symbol';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import { assert } from 'chai';
import 'mocha';


let constructorHelpSrc =
`<?php
    class MyClass {
        function __construct($param1, $param2){

        }
    }
    $var = new MyClass();
`;

let inbuiltConstructorHelpSrc = 
`<?php
    $pdo = new PDO()
`;


function setup(src: string) {

    let docStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    docStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
    return new SignatureHelpProvider(symbolStore, docStore);
}

function setupInbuilt(src:string){
    let docStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    docStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
    symbolStore.add(SymbolTable.createBuiltIn());
    return new SignatureHelpProvider(symbolStore, docStore);
}


describe('SignatureHelpProvider', function () {

    describe('#provideSignatureHelp', function () {

        it('constructor help', function () {

            let provider = setup(constructorHelpSrc);
            let help = provider.provideSignatureHelp('test', {line: 6, character:23});
            //console.log(JSON.stringify(help, null, 4)); 

        });

        it('inbuilt symbol constructor help', function(){
            let provider = setupInbuilt(inbuiltConstructorHelpSrc);
            let help = provider.provideSignatureHelp('test', {line: 1, character:19});
            console.log(JSON.stringify(help, null, 4)); 
        });

    });


});