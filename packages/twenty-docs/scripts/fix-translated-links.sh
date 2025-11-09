#!/bin/bash

# Post-processing script to fix internal links in translated documentation
# This script adds the locale prefix to all internal documentation links
# Works for any language by automatically detecting language directories

set -e

# Determine docs directory
if [ -d "packages/twenty-docs" ]; then
  DOCS_DIR="packages/twenty-docs"
elif [ -d "fr" ] || [ -d "user-guide" ]; then
  DOCS_DIR="."
else
  echo "❌ Error: Cannot find documentation directory"
  exit 1
fi

echo "🔧 Fixing internal links in translated documentation..."

# Directories to exclude from processing (non-locale directories)
EXCLUDED_DIRS="images|snippets|user-guide|developers|twenty-ui|node_modules|scripts|getting-started"

# Documentation sections to fix links for
DOC_SECTIONS=("user-guide" "developers" "twenty-ui")

for lang_dir in "$DOCS_DIR"/*/ ; do
  lang_code=$(basename "$lang_dir")

  # Skip excluded directories
  if [[ "$lang_code" =~ ^($EXCLUDED_DIRS)$ ]] || [ ! -d "$lang_dir" ] || [ -z "$(ls -A "$lang_dir")" ]; then
    continue
  fi

  echo "📝 Processing $lang_code documentation..."

  # Process each MDX file once with all replacements
  find "$lang_dir" -name "*.mdx" -type f | while read -r file; do
    # Build sed script with all replacements
    sed_script=""
    for section in "${DOC_SECTIONS[@]}"; do
      sed_script+="s|href=\"/${section}/|href=\"/${lang_code}/${section}/|g;"
      sed_script+="s|](/${section}/|](/${lang_code}/${section}/|g;"
      sed_script+="s|https://docs\.twenty\.com/${section}/|https://docs.twenty.com/${lang_code}/${section}/|g;"
    done
    
    # Apply all replacements in a single sed invocation
    sed -i.bak "$sed_script" "$file"
    rm -f "${file}.bak"
  done

  echo "✅ $lang_code documentation links fixed"
done

echo "🎉 All translated links have been fixed!"

