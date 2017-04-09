import { SignatureHelpProvider } from '../src/signatureHelpProvider';
import { SymbolStore, SymbolTable } from '../src/symbol';
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

function setup(src: string) {

    let docStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    docStore.add(doc);
    symbolStore.add(SymbolTable.create(doc));
    return new SignatureHelpProvider(symbolStore, docStore);
}


describe('SignatureHelpProvider', function () {

    describe('#provideSignatureHelp', function () {

        it('constructor completion', function () {

            let provider = setup(constructorHelpSrc);
            let help = provider.provideSignatureHelp('test', {line: 6, character:23});
            console.log(JSON.stringify(help, null, 4)); 

        })

    });


});