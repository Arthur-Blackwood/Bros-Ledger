UPDATE transactions
SET note = merchant
WHERE TRIM(note) = ''
  AND TRIM(merchant) <> ''
  AND merchant <> 'Untitled transaction';
