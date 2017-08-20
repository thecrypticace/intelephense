import { ParsedDocument } from '../src/parsedDocument';
import { assert } from 'chai';
import 'mocha';

var firstTokenSrc =
    `<?php
    class MyClass { }
`;

describe('ParsedDocument', function () {

    describe('firstToken', function () {

        it('returns first token of phrase', () => {

            let doc = new ParsedDocument('test', firstTokenSrc);
            let classNode = doc.tree.children[2];
            let tFirst = ParsedDocument.firstToken(classNode);
            let expected = {
                tokenType: 9,
                offset: 10,
                length: 5,
                modeStack: [
                    1
                ]
            };
            //console.log(JSON.stringify(tFirst, null, 4));
            assert.deepEqual(tFirst, expected);

        })

    });

});