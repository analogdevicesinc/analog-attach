# attach-no-os-lib

The library behind `attach-noos`: it reads the CAPI repos, keeps the workfile, bootstraps
it, validates it and generates the project.

- [docs/vocabulary.md](docs/vocabulary.md): every key it reads from the CAPI repos, and the
  rules it deduces instead of declaring
- [src/bootstrap/README.md](src/bootstrap/README.md): how bootstrap fills a workfile
- [test/fixtures/README.md](test/fixtures/README.md): the miniature CAPI ecosystem the tests run on
