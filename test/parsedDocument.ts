import { ParsedDocument } from '../src/parsedDocument';
import { assert } from 'chai';
import 'mocha';

var firstTokenSrc =
`<?php
    class MyClass { }
`;

describe('ParsedDocument' ,function(){

    describe('firstToken', function(){

        let doc = new ParsedDocument('test', firstTokenSrc);
        let classNode = (<any>doc.tree).elements[1];
        let tFirst = ParsedDocument.firstToken(classNode);
        console.log(JSON.stringify(doc.tree, ParsedDocument.stringyfyReplacer, 4));
        console.log(JSON.stringify(tFirst, null, 4));

    });

});