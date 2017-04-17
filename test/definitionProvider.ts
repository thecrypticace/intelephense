import { DefinitionProvider } from '../src/definitionProvider';
import { SymbolStore, SymbolTable } from '../src/symbol';
import { ParsedDocumentStore, ParsedDocument } from '../src/parsedDocument';
import * as lsp from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';


function setup(src:string){

    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    let table = SymbolTable.create(doc);
    let docStore = new ParsedDocumentStore();
    docStore.add(doc);
    symbolStore.add(table);
    return new DefinitionProvider(symbolStore,docStore);

}

let objectAccessSrc =
`<?php
    class Test {
        public $foo;
        function bar(){}
    }
    $var = new Test();
    $var->bar();
    $var->foo;
`;

let scopedAccessSrc = 
`<?php
    class Test {
        const FOO = 1;
        static public $bar;
        static function baz(){}
    }
    Test::FOO;
    Test::$bar;
    Test::baz();
`;

describe('DefintionProvider', function(){

    describe('#provideDefinition', function(){

        describe('Object access expr', function(){

            let provider:DefinitionProvider
            before(function(){
                provider = setup(objectAccessSrc);
            }); 

            it('method location', function(){
                let loc = provider.provideDefinition('test', {line:6, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:3, character:8},
                        end:{line:3, character:24}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

            it('property location', function(){
                let loc = provider.provideDefinition('test', {line:7, character:12});
                let expected:lsp.Location = {
                    uri:'test',
                    range:{
                        start:{line:2, character:15},
                        end:{line:2, character:19}
                    }
                } 
                assert.deepEqual(loc, expected);
                //console.log(JSON.stringify(loc, null, 4));
            });

        });

    });



});