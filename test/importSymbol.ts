import { BinarySearch } from '../src/types';
import { assert } from 'chai';
import 'mocha';
import { ParsedDocument, ParsedDocumentStore } from '../src/parsedDocument';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { NameTextEditProvider } from '../src/commands';
import {ReferenceReader} from '../src/referenceReader';
import {ReferenceStore} from '../src/reference';
import {MemoryCache} from '../src/cache';

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
    let refStore = new ReferenceStore(new MemoryCache());
    docStore.add(doc1);
    docStore.add(doc2);
    let symbolStore = new SymbolStore();
    let t1 = SymbolTable.create(doc1);
    let t2 = SymbolTable.create(doc2);
    symbolStore.add(t1);
    symbolStore.add(t2);
    let refTable = ReferenceReader.discoverReferences(doc1, symbolStore);
    let refTable2 = ReferenceReader.discoverReferences(doc2, symbolStore);
    refStore.add(refTable);
    refStore.add(refTable2);

    let expected = [
        {
            range: {
                start: {
                    line: 2,
                    character: 19
                },
                end: {
                    line: 2,
                    character: 27
                }
            },
            newText: "Bar"
        },
        {
            range: {
                start: {
                    line: 1,
                    character: 22
                },
                end: {
                    line: 1,
                    character: 22
                }
            },
            newText: "\n\n        use Foo\\Bar;\n"
        }
    ];


    it('Should return text edits when a symbol can be imported', () => {

        let provider = new NameTextEditProvider(symbolStore, docStore, refStore);
        let edits = provider.provideContractFqnTextEdits('doc2', { line: 2, character: 27 });
        //console.log(JSON.stringify(edits, null, 4));
        assert.deepEqual(edits, expected);
    });

});