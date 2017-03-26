import { SymbolReader, NameResolver, PhpSymbol, SymbolKind, SymbolTable } from '../src/symbol';
import { TextDocument } from '../src/document';
import { ParseTree } from '../src/parse';
import { Parser } from 'php7parser';
import {TreeTraverser} from '../src/types';
import { expect } from 'chai';
import 'mocha';

const src =
    `<?php
        namespace Test;
        function testFunction($param1, $param2) {

        }`;

let doc = new TextDocument('test', src);
let tree = new ParseTree('test', Parser.parse(src));
let symbolRoot: PhpSymbol = { kind: SymbolKind.None, name: '' };
let sr = new SymbolReader(doc, new NameResolver('', '', []), [symbolRoot]);
let traverser = new TreeTraverser([tree.root]);
traverser.traverse(sr);
let table = new SymbolTable('test', symbolRoot);

//console.log(JSON.stringify(symbolRoot, null, 4));

console.log(JSON.stringify(table.symbols, null, 4));

describe('Symbol Reader', () => {

    it('symbols', () => {

        
    });
});