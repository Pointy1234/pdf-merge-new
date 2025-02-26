import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import dotenv from 'dotenv';
import fontkit from '@pdf-lib/fontkit';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

async function downloadFile(url, outputPath) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Ошибка при скачивании файла: ${response.statusText}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.promises.writeFile(outputPath, buffer);
        console.log(`Файл скачан и сохранен как: ${outputPath}`);
    } catch (error) {
        console.error(`Ошибка при скачивании файла по URL ${url}:`, error);
    }
}

function createWatermarkText(watermarkText) {
    if (!watermarkText || typeof watermarkText.certificateNumber !== 'string' ||
        typeof watermarkText.owner !== 'string') {
        throw new Error('Некорректные данные для водяного знака');
    }
    const validityDate = new Date(watermarkText.validity);
    const isValidDate = !isNaN(validityDate.getTime());
    const formattedValidityDate = isValidDate ? validityDate.toLocaleDateString() : 'Дата не указана';
    return `Документ подписан усиленной квалифицированной электронной подписью\nСертификат: ${watermarkText.certificateNumber}\nВладелец: ${watermarkText.owner}\nДействителен до: ${formattedValidityDate}`;
}

async function addWatermarks(pdfDoc, signatures, isFirstDocument, isLastDocument) {
    const fontPath = './fonts/643e59524d730ce6c6f2384eebf945f8.ttf';
    const fontBytes = await fs.promises.readFile(fontPath);
    let customFont;

    if (fontBytes) {
        pdfDoc.registerFontkit(fontkit);
        customFont = await pdfDoc.embedFont(fontBytes);
    }

    const pages = pdfDoc.getPages();
    const lastPageIndex = pages.length - 1;

    // Общие параметры расположения
    const stampWidth = 200;
    const stampHeight = 50;
    const yPosition = 50;

    // Водяные знаки только на последней странице первого и последнего документа
    if (isFirstDocument || isLastDocument) {
        const page = pages[lastPageIndex];
        if (signatures.length === 1) {
            const watermarkText = createWatermarkText(signatures[0]);
            drawStamp(page, watermarkText, customFont, (page.getWidth() - stampWidth) / 2, yPosition, stampWidth, stampHeight);
        } else if (signatures.length === 2) {
            const watermarkTextFirst = createWatermarkText(signatures[0]);
            const watermarkTextSecond = createWatermarkText(signatures[1]);

            // Первый штамп слева, второй рядом
            drawStamp(page, watermarkTextFirst, customFont, 50, yPosition, stampWidth, stampHeight);
            drawStamp(page, watermarkTextSecond, customFont, 300, yPosition, stampWidth, stampHeight);
        }
    }

    return pdfDoc;
}

function drawStamp(page, text, font, x, y, width, height) {
    const adjustedYText = y + 30; // Смещение текста выше
    const adjustedYRect = y - 10; // Смещение обводки ниже
    page.drawRectangle({
        x: x,
        y: adjustedYRect,
        width: width,
        height: height,
        borderColor: rgb(0.75, 0.75, 0.75),
        borderWidth: 1
    });

    page.drawText(text, {
        x: x + 10,
        y: adjustedYText,
        size: 5,
        font: font,
        color: rgb(0.75, 0.75, 0.75),
        lineHeight: 10,
        maxWidth: width - 20
    });
}

// async function addImageToFirstPage(pdfDoc) {
//     const imagePath = './images/image.png';
//     if (fs.existsSync(imagePath)) {
//         const imageBytes = await fs.promises.readFile(imagePath);
//         const pngImage = await pdfDoc.embedPng(imageBytes);
//         const pages = pdfDoc.getPages();
//         if (pages.length > 0) {
//             const firstPage = pages[0];
//             const { width, height } = firstPage.getSize();
//             const imgWidth = 468; // Ширина изображения (16.50 см)
//             const imgHeight = 181; // Высота изображения (6.39 см)
//             firstPage.drawImage(pngImage, {
//                 x: (width - imgWidth) / 2, // Центрирование по горизонтали
//                 y: height - imgHeight - 10, // Смещение от верхнего края
//                 width: imgWidth,
//                 height: imgHeight
//             });
//         }
//     } else {
//         console.warn('Изображение image.png не найдено.');
//     }
// }

async function mergePdfs(filePaths, signatures) {
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < filePaths.length; i++) {
        try {
            const pdfBytes = await fs.promises.readFile(filePaths[i]);
            const pdfDoc = await PDFDocument.load(pdfBytes);

            // Вставляем картинку только на первую страницу первого документа
            // if (i === 0) {
            //     await addImageToFirstPage(pdfDoc);
            // }

            // Вставляем водяные знаки для первого и последнего документов
            const isFirstDocument = i === 0;
            const isLastDocument = i === filePaths.length - 1;
            await addWatermarks(pdfDoc, signatures, isFirstDocument, isLastDocument);

            const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPages().map((_, index) => index));
            copiedPages.forEach(page => mergedPdf.addPage(page));
        } catch (error) {
            console.error(`Ошибка при обработке файла ${filePaths[i]}:`, error);
        }
    }

    const mergedPdfBytes = await mergedPdf.save();
    return mergedPdfBytes;
}

async function processPdfs(urls, signatures) {
    try {
        const tempDir = './temp';

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        } else {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                fs.unlinkSync(filePath);
            }
        }

        const filePaths = [];

        for (let i = 0; i < urls.length; i++) {
            const filePath = path.join(tempDir, `file${i + 1}.pdf`);
            await downloadFile(urls[i], filePath);
            filePaths.push(filePath);
        }

        const mergedPdfBytes = await mergePdfs(filePaths, signatures);
        return mergedPdfBytes;
    } catch (error) {
        console.error('Ошибка при обработке файлов:', error);
        throw error;
    }
}

const app = express();
app.use(bodyParser.json());

app.post('/process-pdfs', async (req, res) => {
    const { urls, signatures } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Необходимо передать массив URL для обработки.' });
    }

    try {
        const mergedPdfBytes = await processPdfs(urls, signatures);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
        res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error('Ошибка при обработке PDF файлов:', error);
        res.status(500).json({ error: 'Ошибка при обработке PDF файлов.' });
    }
});

app.post('/add-text-to-pdf', async (req, res) => {
    const { url, texts } = req.body;

    if (!url || !Array.isArray(texts) || texts.length === 0) {
        return res.status(400).json({ error: 'Необходимо передать url и массив texts с параметрами x, y, text, fontSize.' });
    }

    try {
        const tempFilePath = './temp/temp.pdf';
        await downloadFile(url, tempFilePath);

        const pdfBytes = await fs.promises.readFile(tempFilePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);

        pdfDoc.registerFontkit(fontkit);
        const fontPath = './fonts/643e59524d730ce6c6f2384eebf945f8.ttf';
        let customFont;
        if (fs.existsSync(fontPath)) {
            const fontBytes = await fs.promises.readFile(fontPath);
            customFont = await pdfDoc.embedFont(fontBytes);
        }

        const firstPage = pdfDoc.getPages()[0];
        texts.forEach(({ text, x, y, fontSize }) => {
            firstPage.drawText(text, {
                x,
                y,
                size: fontSize || 12,
                font: customFont || firstPage.getFont(),
                color: rgb(0.75, 0.75, 0.75),
            });
        });

        const modifiedPdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="modified.pdf"');
        res.send(Buffer.from(modifiedPdfBytes));
    } catch (error) {
        console.error('Ошибка при обработке PDF:', error);
        res.status(500).json({ error: 'Ошибка при обработке PDF.' });
    }
});


const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});
