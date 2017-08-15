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
    function bar(string $a) { 
        echo $a;
        $fn = function ($b) use ($a) {
            echo $a, $b;
        }; 
    }

    class Foo {
        const C = 1;
        public $p;
        function __construct(){}
        function fn(){
            echo $this->p, self::C;
            bar(1);
        }
    }

    $v = new Foo();
    $v->fn();
    $v->p;
    $v::C;
    bar($v);
    Foo::C;
    `;

function setup(src: string) {
    let docStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let doc = new ParsedDocument('test', src);
    docStore.add(doc);
    let table = SymbolTable.create(doc);
    symbolStore.add(table);
    ReferenceReader.discoverReferences(doc, table, symbolStore);
    symbolStore.indexReferences(table);
    //console.log(JSON.stringify(table.find((x)=>{return x.name === 'bar'}), null, 4));
    return new ReferenceProvider(docStore, symbolStore);
}

describe('ReferencesProvider', () => {

    it('function refs', () => {

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 22,
                        "character": 4
                    },
                    "end": {
                        "line": 22,
                        "character": 7
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 1,
                        "character": 13
                    },
                    "end": {
                        "line": 1,
                        "character": 16
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 14,
                        "character": 12
                    },
                    "end": {
                        "line": 14,
                        "character": 15
                    }
                }
            }
        ];

            let provider = setup(src);
            let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 22, character: 7 }, <lsp.ReferenceContext>{ includeDeclaration: true });
            //console.log(JSON.stringify(locs, null, 4));
            assert.deepEqual(locs, expected);

    });

    it('Class refs', () => {

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 18,
                        "character": 13
                    },
                    "end": {
                        "line": 18,
                        "character": 16
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 23,
                        "character": 4
                    },
                    "end": {
                        "line": 23,
                        "character": 7
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 8,
                        "character": 10
                    },
                    "end": {
                        "line": 8,
                        "character": 13
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 13,
                        "character": 27
                    },
                    "end": {
                        "line": 13,
                        "character": 31
                    }
                }
            }
        ];


            let provider = setup(src);
            let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 18, character: 16 }, <lsp.ReferenceContext>{ includeDeclaration: true });
            assert.deepEqual(locs, expected);
            //console.log(JSON.stringify(locs, null, 4));

    });

    it('var refs', () => {

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 18,
                        "character": 4
                    },
                    "end": {
                        "line": 18,
                        "character": 6
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 19,
                        "character": 4
                    },
                    "end": {
                        "line": 19,
                        "character": 6
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 20,
                        "character": 4
                    },
                    "end": {
                        "line": 20,
                        "character": 6
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 21,
                        "character": 4
                    },
                    "end": {
                        "line": 21,
                        "character": 6
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 22,
                        "character": 8
                    },
                    "end": {
                        "line": 22,
                        "character": 10
                    }
                }
            }
        ];

        let provider = setup(src);
        let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 18, character: 6 }, <lsp.ReferenceContext>{ includeDeclaration: true });
        assert.deepEqual(locs, expected);
        //console.log(JSON.stringify(locs, null, 4));

    });

    it('method refs', ()=> {

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 19,
                        "character": 8
                    },
                    "end": {
                        "line": 19,
                        "character": 10
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 12,
                        "character": 17
                    },
                    "end": {
                        "line": 12,
                        "character": 19
                    }
                }
            }
        ];
        let provider = setup(src);
        let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 19, character: 9 }, <lsp.ReferenceContext>{ includeDeclaration: true });
        assert.deepEqual(locs, expected);
        //console.log(JSON.stringify(locs, null, 4));

    });

    it('class const', ()=>{

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 21,
                        "character": 8
                    },
                    "end": {
                        "line": 21,
                        "character": 9
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 23,
                        "character": 9
                    },
                    "end": {
                        "line": 23,
                        "character": 10
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 9,
                        "character": 14
                    },
                    "end": {
                        "line": 9,
                        "character": 15
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 13,
                        "character": 33
                    },
                    "end": {
                        "line": 13,
                        "character": 34
                    }
                }
            }
        ];
        let provider = setup(src);
        let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 13, character: 33 }, <lsp.ReferenceContext>{ includeDeclaration: true });
        assert.deepEqual(locs, expected);
        //console.log(JSON.stringify(locs, null, 4));

    });

    it('properties', () => {

        let expected = [
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 20,
                        "character": 8
                    },
                    "end": {
                        "line": 20,
                        "character": 9
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 10,
                        "character": 15
                    },
                    "end": {
                        "line": 10,
                        "character": 17
                    }
                }
            },
            {
                "uri": "test",
                "range": {
                    "start": {
                        "line": 13,
                        "character": 24
                    },
                    "end": {
                        "line": 13,
                        "character": 25
                    }
                }
            }
        ];
        let provider = setup(src);
        let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 20, character: 9 }, <lsp.ReferenceContext>{ includeDeclaration: true });
        assert.deepEqual(locs, expected);
        //console.log(JSON.stringify(locs, null, 4));
    });

    it('parameter refs, closure use', () => {

let expected = [
    {
        "uri": "test",
        "range": {
            "start": {
                "line": 1,
                "character": 24
            },
            "end": {
                "line": 1,
                "character": 26
            }
        }
    },
    {
        "uri": "test",
        "range": {
            "start": {
                "line": 2,
                "character": 13
            },
            "end": {
                "line": 2,
                "character": 15
            }
        }
    },
    {
        "uri": "test",
        "range": {
            "start": {
                "line": 3,
                "character": 33
            },
            "end": {
                "line": 3,
                "character": 35
            }
        }
    },
    {
        "uri": "test",
        "range": {
            "start": {
                "line": 4,
                "character": 17
            },
            "end": {
                "line": 4,
                "character": 19
            }
        }
    }
];

        let provider = setup(src);
        let locs = provider.provideReferenceLocations('test', <lsp.Position>{ line: 1, character: 26 }, <lsp.ReferenceContext>{ includeDeclaration: true });
        assert.deepEqual(locs, expected);
        //console.log(JSON.stringify(locs, null, 4));
    });

}); 