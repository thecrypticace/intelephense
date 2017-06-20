import { BinarySearch } from '../src/types';
import { assert } from 'chai';
import 'mocha';
import { ParsedDocument, ParsedDocumentStore } from '../src/parsedDocument';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { importSymbol } from '../src/commands';

describe('importSymbol', () => {

    let src1 =
        `<?php
        namespace Foo;
        class Bar {}
    `;

    let src2 =
        `<?php
        namespace Baz;
        $var = new \\Foo\\Bar;
    `;

    let doc1 = new ParsedDocument('doc1', src1);
    let doc2 = new ParsedDocument('doc2', src2);
    let docStore = new ParsedDocumentStore();
    docStore.add(doc1);
    docStore.add(doc2);
    let symbolStore = new SymbolStore();
    symbolStore.add(SymbolTable.create(doc1));
    symbolStore.add(SymbolTable.create(doc2));


    it('Should return text edits when a symbol can be imported', () => {

        let edits = importSymbol(symbolStore, docStore, {uri:'doc2'}, {line: 2, character:27});
        console.log(JSON.stringify(edits, null, 4));

    });

});