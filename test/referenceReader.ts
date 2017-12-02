import { SymbolKind } from '../src/symbol';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import { ReferenceReader } from '../src/referenceReader';
import { ReferenceStore } from '../src/reference';
import { MemoryCache } from '../src/cache';
import 'mocha';
import { SymbolReader } from '../src/symbolReader';

function readReferences(src:string) {

    let store = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    let table = SymbolTable.create(doc);
    //console.log(JSON.stringify(table, null, 4));
    store.add(table);
    return ReferenceReader.discoverReferences(doc, store);

}

let issue82Src = 
`<?php
class SomeClass
{
    public function someFunction($in)
    {
        function () use ($in) {
            return '';
        };
    }

    public function someOtherFunction()
    {
        //trigger Undefined index: ccn
        return false || true;
    }
}
`;


describe('ReferenceReader', () => {

    it('issue 82', () => {

        let refTable = readReferences(issue82Src);


    });


});
