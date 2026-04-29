# Contributing to Analog Attach

Thank you for your interest in contributing to Analog Attach! This document
provides guidelines for contributing to the project.

## Types of Contributions

We welcome the following types of contributions:

- Bug reports
- Bug fixes
- Documentation improvements
- New feature implementations
- Test coverage improvements

## Bug Reports

When submitting a bug report, please include:

1. **VS Code version** and **extension version**
2. **Operating system** (Linux distribution, macOS, Windows)
3. **Steps to reproduce** the issue
4. **Expected behavior** vs **actual behavior**
5. **Sample DTS/DTSO file** (if applicable)
6. **Screenshots** (if UI-related)
7. **Error messages** from the Output panel (View > Output > Extension Host)

Submit bug reports via [GitHub Issues](https://github.com/analogdevicesinc/analog-attach/issues).

## Feature Requests

For feature requests:

1. Check existing issues to avoid duplicates
2. Describe the use case and why it would be valuable
3. Provide examples of how the feature would work

## Contributing Code

### Getting Started

1. Fork the repository
2. Clone your fork with submodules:
   ```bash
   git clone --recursive <your-fork-url>
   ```
3. Follow the setup instructions in [DEVELOPMENT.md](DEVELOPMENT.md)

### Development Workflow

1. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines below

3. Run tests:
   ```bash
   yarn test
   ```

4. Run linting:
   ```bash
   yarn lint
   ```

5. Commit your changes with Signed-off-by and with a clear message:
   ```bash
   git commit -sm "feat: add new feature description"
   ```

6. Push and create a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

### Commit Messages

Follow conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### Pull Request Guidelines

1. Keep PRs focused on a single change
2. Update documentation if needed
3. Add tests for new functionality
4. Ensure all tests pass
5. Ensure linting passes
6. Provide a clear description of the changes

## Project Structure

See [DEVELOPMENT.md](DEVELOPMENT.md) for details on the project structure and build process.

## Questions?

If you have questions about contributing, feel free to open a discussion on GitHub.
