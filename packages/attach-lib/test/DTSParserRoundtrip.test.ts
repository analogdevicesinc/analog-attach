import * as fs from 'node:fs';
import path from 'node:path';

import { execFileSync, spawnSync } from 'node:child_process';
import { parse_dts, printDts } from 'attach-lib';
import { ensure_directory } from './testing_utils';

import { test, expect } from 'vitest';

function hasExecutable(commandName: string): boolean {
  if (process.platform === 'win32') {
    const probeWin = spawnSync('where', [commandName], { stdio: 'ignore' });
    return probeWin.status === 0;
  }
  const probe = spawnSync('sh', ['-c', `command -v ${commandName} >/dev/null 2>&1`], { stdio: 'ignore' });
  return probe.status === 0;
}

function assertIdenticalDts(
  absolute_cache_directory: string,
  absolute_source_path: string,
  our_dt: string,
) {
  ensure_directory(absolute_cache_directory);

  const orig_dt = path.parse(absolute_source_path).name;

  const orig_dtb_name: string = `${orig_dt}.dtb`;

  const our_decompiled_name: string = `${our_dt}.decompiled.dts`;
  const orig_decompiled_name: string = `${orig_dt}.decompiled.dts`;

  const our_dts_name: string = `${our_dt}.dts`;
  const our_dtb_name: string = `${our_dt}.dtb`;

  const originalText = fs.readFileSync(absolute_source_path, 'utf8');

  // First, compile original DTS to DTB and decompile to get stable phandle assignments
  const ourDtbPath = path.join(absolute_cache_directory, our_dtb_name);
  const origDtbPath = path.join(absolute_cache_directory, orig_dtb_name);
  execFileSync('dtc', ['-@', '-I', 'dts', '-O', 'dtb', '-o', origDtbPath, absolute_source_path], { stdio: 'ignore' });
  // Decompile original DTB to DTS
  const origDecompiledPath = path.join(absolute_cache_directory, orig_decompiled_name);
  execFileSync('dtc', ['-s', '-I', 'dtb', '-O', 'dts', '-o', origDecompiledPath, origDtbPath], { stdio: 'ignore' });

  const origDecompiled = fs.readFileSync(origDecompiledPath, 'utf8');

  const document = parse_dts(originalText);
  const ourText = printDts(document);
  const ourDtsPath = path.join(absolute_cache_directory, our_dts_name);
  fs.writeFileSync(ourDtsPath, ourText, 'utf8');

  // Compile our DTS to DTB and decompile
  const ourDecompiledPath = path.join(absolute_cache_directory, our_decompiled_name);
  execFileSync('dtc', ['-@', '-I', 'dts', '-O', 'dtb', '-o', ourDtbPath, ourDtsPath], { stdio: 'ignore' });
  execFileSync('dtc', ['-s', '-I', 'dtb', '-O', 'dts', '-o', ourDecompiledPath, ourDtbPath], { stdio: 'ignore' });

  // Compare decompiled outputs
  const ourDecompiled = fs.readFileSync(ourDecompiledPath, 'utf8');

  expect(ourDecompiled, 'decompiled DTS files differ').toStrictEqual(origDecompiled);
}

test('local rpi roundtrip compile+decompile equals original compile+decompile', function (context) {

  if (!hasExecutable('dtc')) {
    // dtc is required for this test; skip when not available in environment
    context.skip();
  }

  const absolute_cache_directory = path.resolve(__dirname, 'expected/cache');
  const absolute_source_path = path.resolve(__dirname, 'dts_source/rpi.prepro.dts');
  const our_dt = 'my_rpi';

  assertIdenticalDts(
    absolute_cache_directory,
    absolute_source_path,
    our_dt,
  );

});

test('local zephyr roundtrip compile+decompile equals original compile+decompile', function (context) {

  if (!hasExecutable('dtc')) {
    // dtc is required for this test; skip when not available in environment
    context.skip();
  }
  const absolute_cache_directory = path.resolve(__dirname, 'expected/cache');
  const absolute_source_path = path.resolve(__dirname, 'dts_source/zephyr.dts');
  const our_dt = 'my_zephyr';

  assertIdenticalDts(
    absolute_cache_directory,
    absolute_source_path,
    our_dt,
  );
});

test('linux repo arm broadcom roundtrip comp+decomp === original comp+decomp', function (context) {

  if (!hasExecutable('dtc')) {
    console.warn('WARNING: dtc is required for this test; skip when not available in environment');
    context.skip();
  }

  if (!hasExecutable('cpp')) {
    console.warn('WARNING: cpp is required for this test; skip when not available in environment');
    context.skip();
  }
  const absolute_cache_directory = path.resolve(__dirname, 'expected/cache');
  ensure_directory(absolute_cache_directory);

  const path_to_dts_folder = path.resolve(__dirname, 'linux/arch/arm/boot/dts/broadcom/');
  const path_to_linux_include = path.resolve(__dirname, 'linux/include');

  if (!fs.existsSync(path_to_dts_folder)) {
    console.warn(`WARNING: could not find ${path_to_dts_folder}`);
    context.skip();
  }

  if (!fs.existsSync(path_to_dts_folder)) {
    console.warn(`WARNING: could not find ${path_to_linux_include}`);
    context.skip();
  }

  const dts_folder_content = fs.readdirSync(path_to_dts_folder);

  if (dts_folder_content.length === 0) {
    console.warn(`${path_to_dts_folder} is empty`);
    context.skip();
  }

  type FileInfo = {
    file_name: string,
    file_path: string,
  };

  const dts_files: FileInfo[] = ((): FileInfo[] => {
    let accumulator: FileInfo[] = [];
    for (const file_name of dts_folder_content) {
      if (file_name.endsWith(".dts")) {
        accumulator.push({ file_name: file_name, file_path: path.resolve(path_to_dts_folder, file_name) });
      }
      if (file_name === "bcm-cygnus-clock.dtsi") {
        fs.copyFileSync(path.resolve(path_to_dts_folder, file_name), path.resolve(absolute_cache_directory, file_name));
      }
    }
    return accumulator;
  })();

  if (dts_files.length === 0) {
    console.warn(`WARNING: no .dts in ${path_to_dts_folder}`);
    context.skip();
  }

  const prepro_dts_files: FileInfo[] = ((): FileInfo[] => {

    let prepro: FileInfo[] = [];

    for (const file of dts_files) {
      const file_name = file.file_name.replaceAll('.dts', '.prepro.dts');
      const cache = path.resolve(__dirname, 'expected/cache');
      const prepro_path = path.resolve(cache, file_name);

      try {
        execFileSync('cpp', ['-nostdinc', '-I', path_to_linux_include, '-undef', '-x', 'assembler-with-cpp', file.file_path, prepro_path], { stdio: 'ignore' });
        prepro.push({ file_name: file_name, file_path: prepro_path });
      } catch { }

    }

    return prepro;
  })();

  for (const prepro_dts of prepro_dts_files) {
    const dt_name = prepro_dts.file_name.replaceAll('.prepro.dts', '');
    if (dt_name.includes('bcm911') || dt_name.includes('bcm95')) {
      continue;
    }
    try {
      assertIdenticalDts(absolute_cache_directory, prepro_dts.file_path, `my_${dt_name}`);
    } catch (error) {
      expect.fail(`Failed for ${dt_name} with :\n${error}`);
    }
  }

}, 120_000);
