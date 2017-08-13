import { ReferenceProvider } from '../src/referenceProvider';
import { SymbolKind } from '../src/symbol';
import { SymbolStore, SymbolTable } from '../src/symbolStore';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import { ReferenceReader } from '../src/referenceReader';
import 'mocha';

let src =
    `<?php
    function bar($param) { 
        echo $param;
    }

    class Foo {
        const C = 1;
        public $p;
        function __construct(){}
        function fn(){}
    }

    $v = new Foo();
    $v->fn();
    $v->p;
    $v::C;
    `;