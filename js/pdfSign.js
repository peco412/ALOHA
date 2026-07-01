/**
 * pdfSign.js
 * Module xử lý chữ ký số (ảnh chữ ký/mộc) đóng lên file PDF.
 * Dùng thư viện pdf-lib (load qua CDN trong HTML).
 *
 * Nguyên lý: Mở file PDF gốc -> chèn ảnh chữ ký vào vị trí chỉ định trên trang
 * cuối (mặc định) -> xuất ra file PDF mới (Blob) -> upload lên Supabase Storage,
 * thay thế current_file_url bằng bản đã ký (giữ nguyên original_file_url).
 */

const PdfSign = (() => {

  /**
   * Chèn 1 ảnh chữ ký vào PDF tại vị trí cho trước.
   * @param {Blob|ArrayBuffer} pdfSource - File PDF gốc (Blob hoặc ArrayBuffer)
   * @param {string} imageUrl - URL ảnh chữ ký (PNG, nên có nền trong suốt)
   * @param {object} opts - { pageIndex (mặc định trang cuối), x, y, width, height }
   * @returns {Promise<Blob>} - PDF mới dạng Blob (application/pdf)
   */
  async function embedSignature(pdfSource, imageUrl, opts = {}) {
    const { PDFDocument } = PDFLib;

    const pdfBytes = pdfSource instanceof Blob ? await pdfSource.arrayBuffer() : pdfSource;
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Tải ảnh chữ ký
    const imgResp = await fetch(imageUrl);
    const imgBytes = await imgResp.arrayBuffer();
    const isPng = imageUrl.toLowerCase().includes('.png') ||
                  imgResp.headers.get('content-type')?.includes('png');
    const embeddedImg = isPng
      ? await pdfDoc.embedPng(imgBytes)
      : await pdfDoc.embedJpg(imgBytes);

    const pages = pdfDoc.getPages();
    const pageIndex = opts.pageIndex ?? pages.length - 1; // mặc định: trang cuối
    const page = pages[Math.max(0, Math.min(pageIndex, pages.length - 1))];
    const { width: pageW, height: pageH } = page.getSize();

    // Kích thước chữ ký mặc định: 120x60pt, đặt góc dưới phải, cách lề 60pt
    const sigW = opts.width || 120;
    const sigH = opts.height || 60;
    const x = opts.x ?? (pageW - sigW - 60);
    const y = opts.y ?? 80;

    page.drawImage(embeddedImg, { x, y, width: sigW, height: sigH });

    const outBytes = await pdfDoc.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  /**
   * Chèn nhiều chữ ký/mộc cùng lúc (dùng khi 1 file cần qua nhiều cấp ký
   * nhưng muốn gộp lại 1 lần xử lý — thường không cần, vì hệ thống ký
   * từng bước một và lưu lại file sau mỗi bước).
   */
  async function embedMultiple(pdfSource, items) {
    let currentBytes = pdfSource instanceof Blob ? await pdfSource.arrayBuffer() : pdfSource;
    for (const item of items) {
      const blob = await embedSignature(currentBytes, item.imageUrl, item);
      currentBytes = await blob.arrayBuffer();
    }
    return new Blob([currentBytes], { type: 'application/pdf' });
  }

  /**
   * Quy trình đầy đủ: lấy file hiện tại của 1 submission, chèn chữ ký của
   * user đang ký, upload lên Storage, trả về URL mới.
   * @param {string} currentFileUrl - URL file PDF hiện tại
   * @param {string} signatureImageUrl - URL ảnh chữ ký/mộc cần chèn
   * @param {string} folder - thư mục lưu trên Storage (vd: 'signed/facility')
   * @param {object} placement - { x, y, width, height, pageIndex } tùy chọn vị trí
   */
  async function signAndUpload(currentFileUrl, signatureImageUrl, folder, placement = {}) {
    const resp = await fetch(currentFileUrl);
    if (!resp.ok) throw new Error('Không tải được file gốc để ký.');
    const pdfBlob = await resp.blob();

    const signedBlob = await embedSignature(pdfBlob, signatureImageUrl, placement);

    // Đóng gói thành File object để dùng chung hàm DB.uploadFile
    const fileName = `signed_${Date.now()}.pdf`;
    const signedFile = new File([signedBlob], fileName, { type: 'application/pdf' });
    const uploaded = await DB.uploadFile(signedFile, folder);
    return uploaded.url;
  }

  return { embedSignature, embedMultiple, signAndUpload };
})();
