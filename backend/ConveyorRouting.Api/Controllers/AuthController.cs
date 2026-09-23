using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ConveyorRouting.Api.Models;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace ConveyorRouting.Api.Controllers
{
    /// <summary>Same token endpoint as SmartMES_ReportAPI (tokens from either API are interchangeable).</summary>
    [EnableCors("AllowOrigin")]
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private readonly JwtSettings _jwtSettings;

        public AuthController(IOptions<JwtSettings> jwtSettings)
        {
            _jwtSettings = jwtSettings.Value;
        }

        [HttpGet("getToken")]
        public IActionResult GetToken()
        {
            var claims = new[] { new Claim(ClaimTypes.Name, "frontendUser") };
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSettings.Key));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
            var token = new JwtSecurityToken(claims: claims, expires: DateTime.Now.AddHours(8), signingCredentials: creds);
            return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(token) });
        }
    }
}
