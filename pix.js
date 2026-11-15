// "Pix copia e cola" (BR Code estático do Banco Central, padrão EMV) com valor e identificador.

const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

const limpar = (s, max) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 .\-@+]/g, '').trim().slice(0, max);

export function crc16(txt) {
  let crc = 0xFFFF;
  for (let i = 0; i < txt.length; i++) {
    crc ^= txt.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function pixCopiaECola({ chave, nome, cidade, valor, txid, descricao }) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave).trim())
    + (descricao ? campo('02', limpar(descricao, 40)) : '');
  let p = campo('00', '01')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986')
    + (valor > 0 ? campo('54', Number(valor).toFixed(2)) : '')
    + campo('58', 'BR')
    + campo('59', limpar(nome, 25) || 'RECEBEDOR')
    + campo('60', limpar(cidade, 15) || 'BRASIL')
    + campo('62', campo('05', (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***'))
    + '6304';
  return p + crc16(p);
}
