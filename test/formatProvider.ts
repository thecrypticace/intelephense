import { FormatProvider } from '../src/formatProvider';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import { ReferenceReader } from '../src/referenceReader';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';


function setup(src:string){
    let doc = new ParsedDocument('test', src);
    let docStore = new ParsedDocumentStore();
    docStore.add(doc);

    return new FormatProvider(docStore);
}

let fixExtraLinesSrc = 
`<?php
function fn()
{
    //dont put newlines after this
}
`;

let conditionalCurlySrc =
`<?php
if (true) {
}
else {
}
`;

let lcKeywords = 
`<?php
$foo = Array();
`;


describe('provideDocumentFormattingEdits', ()=>{


    it('no extra newlines for } after comment', ()=>{
        let provider = setup(fixExtraLinesSrc);
        let edits = provider.provideDocumentFormattingEdits({uri: 'test'}, {tabSize:4, insertSpaces:true});
        //console.log(JSON.stringify(edits, null, 4));
        assert.isArray(edits);
        assert.isEmpty(edits);
    });

    it('single space before else', ()=>{
        let provider = setup(conditionalCurlySrc);
        let edits = provider.provideDocumentFormattingEdits({uri: 'test'}, {tabSize:4, insertSpaces:true});
        //console.log(JSON.stringify(edits, null, 4));
        let expected = [
            {
                range: {
                    start: {
                        line: 2,
                        character: 1
                    },
                    end: {
                        line: 3,
                        character: 0
                    }
                },
                newText: " "
            }
        ];
        assert.deepEqual(edits, expected);
    });

    it('lowercase keywords', ()=>{
        let provider = setup(lcKeywords);
        let edits = provider.provideDocumentFormattingEdits({uri: 'test'}, {tabSize:4, insertSpaces:true});
        //console.log(JSON.stringify(edits, null, 4));
        let expected = [
            {
                range: {
                    start: {
                        line: 1,
                        character: 7
                    },
                    end: {
                        line: 1,
                        character: 12
                    }
                },
                newText: "array"
            }
        ];
        assert.deepEqual(edits, expected);
    });

});