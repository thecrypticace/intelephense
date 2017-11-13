# Change Log

## [0.8.1] - 2017-11-13
#### Fixed
* Improved error handling when reading and writing to cache
* use JSONStream for reading/writing large arrays
* completions for static members with static keyword.
* default public members
* global inbuilt variable completions 

## [0.8.0] - 2017-11-05
#### Added
* reference provider
* hover provider
* highlight provider
* Auto add use declarations on completion and associated config option
* Config to enable/disable formatting
* Config to enable/disable backslash prefix of global functions and constants
* Invoke param hints on method/function completion
* phpdoc inheritance
* server side caching

#### Changed
* Return multiple locations for go to defintion when applicable
* Improved type resolution for phpdoc static and $this

#### Fixed
* Extra lines and spaces repeatedly added when formatting
* Various PSR2 format fixes
* Completions within closures
* Go to defintion for defines

#### Dependencies
* php7parser 1.0.2

## [0.7.2] - 2017-07-03
#### Fixed
* Error on signature help for function with no params
* Format weirdness after comments
* Parse error on unset cast
* Workspace discover errors when textDocument is undefined.

#### Dependencies
* php7parser 0.9.9

## [0.7.1] - 2017-06-25
#### Fixed
* Error when reading anonymous classes 

## [0.7.0] - 2017-06-24
#### Added
* PSR2 compatible, lossless document and range formatting.
* Exposed methods to add and remove symbols, enabling client caching.
* Add use declaration command.
* Indexing of constants declared with define(). 

#### Changed
* Improved completions when a use declaration is available.

#### Fixed
* Complex string parsing
* null coalesce expr type resolution
* Cleaned up built-in symbol definitions
* symbol location inaccuracies
* missing completion keywords

#### Dependencies
* php7parser 0.9.8

## [0.6.10] - 2017-04-30
#### Fixed
* Error on variable completion inside anon. functions

## [0.6.9] - 2017-04-23
#### Fixed
* Use group declaration parse bug
* Heredoc parse bug

#### Dependencies
* php7parser 0.9.4

## [0.6.8] - 2017-04-21
#### Fixed
* Crash when encountering parse error on namespace use
* Traits mangling parse tree (php7parser)

#### Dependencies
* php7parser 0.9.3

## [0.6.7] - 2017-04-21
#### Dependencies 
* php7parser 0.9.2

## [0.6.6] - 2017-04-21
#### Added 
* Sorting of fuzzy symbol matches

#### Fixed
* Diagnostics being reported on wrong file.
* Document becoming out of sync when applying multiple changes
* Variable types not resolving in various contexts.

## [0.6.5] - 2017-04-20
#### Changed
* Shortened name completion item labels to name without namespace prefix.
* Shortened method override/implementation completion labels to just method name.
* Reduced completion spam for extends and implements contexts.
* Rolled back indexing on fqn parts.

#### Fixed
* Use directives from other files showing as completion items

## [0.6.4] - 2017-04-19
#### Added
* Detail on variable and constructor completion items.
* Indexing on fqn parts.

#### Fixed
* Variable types not resolving when on rhs of assignment
* Infinite recursion on cyclical inheritance
* Sort order of backslash prefixed completions

## [0.6.2] - 2017-04-18
#### Added
* Tests - DefintionProvider; SignatureHelpProvider; CompletionProvider; TypeString

#### Fixed
* Completion provider fixes and tweaks.
* Definition provider go to property fix.

#### Dependencies
* php7parser 0.9.1

## [0.6.0] - 2017-04-17
#### Added
* Document symbols provider
* Workspace symbols provider
* Type definition provider
* Signature help provider
* Diagnostics provider
* Completion provider
